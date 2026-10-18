import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { creditLedger, creditsAccounts } from '@/lib/db/schema';
import type { CreditKind, LedgerEntry, LedgerFilters, LedgerResponse } from './types';
import { CREDIT_KIND_VALUES } from './types';

/**
 * Credits 计费服务（server-only）。
 *
 * 核心约定：
 * - 懒创建：无账户行视为 balance=0；chargeCredits/getBalance 对无行 user 先 onConflictDoNothing 建行。
 * - 原子扣费：chargeCredits 用单条 SQL `balance = balance - cost`（非读-改-写）+ 同事务 insert 流水，避免并发竞态。
 * - 成本下界：cost 由定价引擎保证 ≥1；扣费不设「余额不足则跳过」——照扣至负（接受单次透支）。
 * - 客户端查询走 /api/agent/credits* Route Handlers，不直接引用本文件。
 */

/** 读余额（无记录=0） */
export async function getBalance(userId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ balance: creditsAccounts.balance })
    .from(creditsAccounts)
    .where(eq(creditsAccounts.userId, userId));
  return row?.balance ?? 0;
}

/**
 * 批量读余额（管理端用户列表用，避免 N+1）：一次 `where userId in (...)` 查全部账户行。
 * 返回 userId → balance 映射；无账户行的用户不在 map 内（调用方按 0 处理，与懒创建约定一致）。
 */
export async function getBalancesByIds(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({ userId: creditsAccounts.userId, balance: creditsAccounts.balance })
    .from(creditsAccounts)
    .where(inArray(creditsAccounts.userId, userIds));
  return new Map(rows.map((row) => [row.userId, row.balance]));
}

/**
 * 入口拦截（无预扣、无冻结，见 docs/credits.md §10）：
 * - 不传 minCost：balance > 0 放行（对话 / 知识库等成本事前未知的入口）；
 * - 传 minCost：balance ≥ 单次固定价放行（图片 / 视频入口，消除固定价业务的单次透支）。
 */
export async function checkBalance(userId: string, minCost?: number): Promise<boolean> {
  const balance = await getBalance(userId);
  return minCost === undefined ? balance > 0 : balance >= Math.max(1, Math.ceil(minCost));
}

/**
 * 原子扣费 + 流水（单事务）：
 * 懒创建账户行 → UPDATE balance=balance-cost RETURNING balanceAfter → insert ledger（delta=-cost）。
 * cost 恒 ≥1（定价引擎 ceil 保证）；余额可被扣成负数（单次透支，后续 checkBalance 拦截）。
 */
export async function chargeCredits(params: {
  userId: string;
  cost: number;
  kind: CreditKind;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  const cost = Math.max(1, Math.ceil(params.cost));
  await db.transaction(async (tx) => {
    // 懒创建：确保账户行存在（并发下 onConflictDoNothing 安全）
    await tx
      .insert(creditsAccounts)
      .values({ userId: params.userId, balance: 0 })
      .onConflictDoNothing();
    // 原子扣费：单条 SQL balance = balance - cost（PostgreSQL 行锁保证并发安全）
    const [updated] = await tx
      .update(creditsAccounts)
      .set({
        balance: sql`${creditsAccounts.balance} - ${cost}`,
        updatedAt: new Date()
      })
      .where(eq(creditsAccounts.userId, params.userId))
      .returning({ balanceAfter: creditsAccounts.balance });
    await tx.insert(creditLedger).values({
      userId: params.userId,
      delta: -cost,
      balanceAfter: updated.balanceAfter,
      kind: params.kind,
      meta: params.meta ?? null
    });
  });
}

/**
 * 发放（upsert 账户 + balance+=amount + 流水 delta=+）。
 * 返回发放后余额。仅经 CLI（scripts/credit-admin.ts）调用——能访问 DATABASE_URL 即视为管理员。
 */
export async function grantCredits(params: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<number> {
  const db = getDb();
  const amount = Math.trunc(params.amount);
  return db.transaction(async (tx) => {
    const [account] = await tx
      .insert(creditsAccounts)
      .values({ userId: params.userId, balance: amount })
      .onConflictDoUpdate({
        target: creditsAccounts.userId,
        set: {
          balance: sql`${creditsAccounts.balance} + ${amount}`,
          updatedAt: new Date()
        }
      })
      .returning({ balance: creditsAccounts.balance });
    await tx.insert(creditLedger).values({
      userId: params.userId,
      delta: amount,
      balanceAfter: account.balance,
      kind: 'grant',
      meta: params.note ? { note: params.note } : null
    });
    return account.balance;
  });
}

/**
 * 直接设定余额（写调整流水，delta=新-旧）。可选 CLI 能力（set 子命令）。
 * SELECT ... FOR UPDATE 锁行：避免与并发 chargeCredits 交错导致 delta 失真 / 扣费被覆盖。
 * 返回设定后余额。
 */
export async function setBalance(params: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<number> {
  const db = getDb();
  const target = Math.trunc(params.amount);
  return db.transaction(async (tx) => {
    await tx
      .insert(creditsAccounts)
      .values({ userId: params.userId, balance: 0 })
      .onConflictDoNothing();
    const [current] = await tx
      .select({ balance: creditsAccounts.balance })
      .from(creditsAccounts)
      .where(eq(creditsAccounts.userId, params.userId))
      .for('update');
    const before = current.balance;
    const [updated] = await tx
      .update(creditsAccounts)
      .set({ balance: target, updatedAt: new Date() })
      .where(eq(creditsAccounts.userId, params.userId))
      .returning({ balanceAfter: creditsAccounts.balance });
    await tx.insert(creditLedger).values({
      userId: params.userId,
      delta: target - before,
      balanceAfter: updated.balanceAfter,
      kind: 'grant',
      meta: { note: params.note ?? 'set', before, after: target }
    });
    return updated.balanceAfter;
  });
}

/** 逗号分隔 kind 筛选 → 数组（非法值丢弃），与知识库列表同模式 */
function splitKinds(value?: string): CreditKind[] | undefined {
  const items = value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item): item is CreditKind => (CREDIT_KIND_VALUES as readonly string[]).includes(item));
  return items && items.length > 0 ? items : undefined;
}

function parseLedgerOrderBy(sort?: string): SQL {
  if (!sort) return desc(creditLedger.createdAt);
  try {
    const parsed = JSON.parse(sort) as { id?: string; desc?: boolean }[];
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const direction = first?.desc ? desc : asc;
    switch (first?.id) {
      case 'delta':
        return direction(creditLedger.delta);
      case 'balanceAfter':
        return direction(creditLedger.balanceAfter);
      case 'createdAt':
        return direction(creditLedger.createdAt);
      default:
        return desc(creditLedger.createdAt);
    }
  } catch {
    return desc(creditLedger.createdAt);
  }
}

function toEntry(row: typeof creditLedger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    userId: row.userId,
    delta: row.delta,
    balanceAfter: row.balanceAfter,
    kind: row.kind as CreditKind,
    meta: row.meta as LedgerEntry['meta'],
    createdAt: row.createdAt.toISOString()
  };
}

/** 流水分页（前端表格）：按 userId 过滤，kind 可选筛选，createdAt 倒序 */
export async function listLedger(userId: string, filters: LedgerFilters): Promise<LedgerResponse> {
  const db = getDb();
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));

  const conditions = [eq(creditLedger.userId, userId)];
  const kinds = splitKinds(filters.kind);
  if (kinds) {
    conditions.push(inArray(creditLedger.kind, kinds));
  }
  const where = and(...conditions);

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(creditLedger)
      .where(where)
      .orderBy(parseLedgerOrderBy(filters.sort))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(creditLedger).where(where)
  ]);

  return {
    entries: rows.map(toEntry),
    total: totalResult[0]?.value ?? 0,
    page,
    limit
  };
}
