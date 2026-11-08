import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { creditLedger, creditReservations, creditsAccounts } from '@/lib/db/schema';
import type { CreditKind, LedgerEntry, LedgerFilters, LedgerResponse } from './types';
import { CREDIT_KIND_VALUES } from './types';

/**
 * Credits 计费服务（server-only）。
 *
 * 可用额度为总余额减冻结额度；预留和结算均在事务中持久化。
 */

export async function getCreditAccount(userId: string): Promise<{
  balance: number;
  reserved: number;
  total: number;
}> {
  const db = getDb();
  const [row] = await db
    .select({ balance: creditsAccounts.balance, reserved: creditsAccounts.reserved })
    .from(creditsAccounts)
    .where(eq(creditsAccounts.userId, userId));
  const total = row?.balance ?? 0;
  const reserved = row?.reserved ?? 0;
  return { balance: total - reserved, reserved, total };
}

/** 可用余额（无记录=0）。 */
export async function getBalance(userId: string): Promise<number> {
  return (await getCreditAccount(userId)).balance;
}

/**
 * 批量读余额（管理端用户列表用，避免 N+1）：一次 `where userId in (...)` 查全部账户行。
 * 返回 userId → balance 映射；无账户行的用户不在 map 内（调用方按 0 处理，与懒创建约定一致）。
 */
export async function getBalancesByIds(userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const db = getDb();
  const rows = await db
    .select({
      userId: creditsAccounts.userId,
      balance: sql<number>`${creditsAccounts.balance} - ${creditsAccounts.reserved}`
    })
    .from(creditsAccounts)
    .where(inArray(creditsAccounts.userId, userIds));
  return new Map(rows.map((row) => [row.userId, row.balance]));
}

/**
 * 入口预检不能替代原子预留：
 * - 不传 minCost：balance > 0 放行（对话 / 知识库等成本事前未知的入口）；
 * - 传 minCost：balance ≥ 单次固定价放行（图片 / 视频入口，消除固定价业务的单次透支）。
 */
export async function checkBalance(userId: string, minCost?: number): Promise<boolean> {
  const balance = await getBalance(userId);
  return minCost === undefined ? balance > 0 : balance >= Math.max(1, Math.ceil(minCost));
}

/**
 * 固定价须全额预留；变动费用可预留目前可用额度与预算的较小值。
 */
export async function reserveCredits(params: {
  userId: string;
  amount: number;
  kind: Exclude<CreditKind, 'grant'>;
  allowPartial?: boolean;
  parentReservationId?: string;
  meta?: Record<string, unknown>;
}): Promise<{ id: string; amount: number } | null> {
  const requested = creditAmount(params.amount, false);
  if (
    params.parentReservationId &&
    (params.allowPartial || (params.kind !== 'image' && params.kind !== 'video'))
  ) {
    throw new Error('Only fixed-price generation can use a chat reservation');
  }
  const db = getDb();
  return db.transaction(async (tx) => {
    let parent: typeof creditReservations.$inferSelect | undefined;
    if (params.parentReservationId) {
      [parent] = await tx
        .select()
        .from(creditReservations)
        .where(
          and(
            eq(creditReservations.id, params.parentReservationId),
            eq(creditReservations.userId, params.userId)
          )
        )
        .for('update');
      if (!parent || parent.kind !== 'chat' || parent.parentReservationId) {
        throw new Error('Invalid parent credit reservation');
      }
      if (parent.status !== 'pending') {
        return null;
      }
    }
    const [account] = await tx
      .select({ balance: creditsAccounts.balance, reserved: creditsAccounts.reserved })
      .from(creditsAccounts)
      .where(eq(creditsAccounts.userId, params.userId))
      .for('update');
    if (!account) return null;
    const available = account.balance - account.reserved;
    const borrowable = parent ? Math.max(0, parent.amount - 1) : 0;
    const availableForRequest = available + borrowable;
    if (availableForRequest < (params.allowPartial ? 1 : requested)) return null;
    const amount = Math.min(availableForRequest, requested);
    const borrowed = Math.max(0, amount - available);
    if (borrowed > 0 && parent) {
      await tx
        .update(creditReservations)
        .set({ amount: parent.amount - borrowed })
        .where(eq(creditReservations.id, parent.id));
    }
    await tx
      .update(creditsAccounts)
      .set({
        reserved: sql`${creditsAccounts.reserved} + ${amount - borrowed}`,
        updatedAt: new Date()
      })
      .where(eq(creditsAccounts.userId, params.userId));
    const [reservation] = await tx
      .insert(creditReservations)
      .values({
        userId: params.userId,
        amount,
        parentReservationId: borrowed > 0 ? parent?.id : null,
        borrowed,
        kind: params.kind,
        meta: params.meta ?? null
      })
      .returning({ id: creditReservations.id });
    return { id: reservation.id, amount };
  });
}

function creditAmount(value: number, allowZero: boolean): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2147483647) {
    throw new Error('Invalid credit amount');
  }
  return value;
}

/** 幂等结算：实际费用至多扣除预留额度，差额在预留记录和流水中留痕。 */
export async function settleCredits(params: {
  reservationId: string;
  cost: number;
  waive?: boolean;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const cost = creditAmount(params.cost, true);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ parentReservationId: creditReservations.parentReservationId })
      .from(creditReservations)
      .where(eq(creditReservations.id, params.reservationId));
    if (!reference) throw new Error(`Credit reservation not found: ${params.reservationId}`);
    let parent: typeof creditReservations.$inferSelect | undefined;
    if (reference.parentReservationId) {
      [parent] = await tx
        .select()
        .from(creditReservations)
        .where(eq(creditReservations.id, reference.parentReservationId))
        .for('update');
      if (!parent) throw new Error('Parent credit reservation not found');
    }
    const [reservation] = await tx
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, params.reservationId))
      .for('update');
    if (!reservation) throw new Error(`Credit reservation not found: ${params.reservationId}`);
    if (reservation.status === 'settled') {
      const expectedCharge = params.waive ? 0 : Math.min(cost, reservation.amount);
      if (reservation.actualCost !== cost || reservation.charged !== expectedCharge) {
        throw new Error('Credit reservation already settled differently');
      }
      return;
    }
    if (reservation.status !== 'pending') throw new Error('Invalid credit reservation status');
    const charged = params.waive ? 0 : Math.min(cost, reservation.amount);
    const returnedToParent =
      parent?.status === 'pending'
        ? Math.min(reservation.borrowed, reservation.amount - charged)
        : 0;
    if (parent && returnedToParent > 0) {
      await tx
        .update(creditReservations)
        .set({ amount: parent.amount + returnedToParent })
        .where(eq(creditReservations.id, parent.id));
    }
    const meta = {
      ...reservation.meta,
      ...params.meta,
      reservationId: reservation.id,
      actualCost: cost,
      absorbedCost: cost - charged
    };
    const [account] = await tx
      .update(creditsAccounts)
      .set({
        balance: sql`${creditsAccounts.balance} - ${charged}`,
        reserved: sql`${creditsAccounts.reserved} - ${reservation.amount} + ${returnedToParent}`,
        updatedAt: new Date()
      })
      .where(eq(creditsAccounts.userId, reservation.userId))
      .returning({ balance: creditsAccounts.balance });
    if (!account) throw new Error('Credit account not found during settlement');
    if (charged > 0) {
      await tx.insert(creditLedger).values({
        userId: reservation.userId,
        delta: -charged,
        balanceAfter: account.balance,
        kind: reservation.kind,
        meta
      });
    }
    await tx
      .update(creditReservations)
      .set({ status: 'settled', actualCost: cost, charged, meta, settledAt: new Date() })
      .where(eq(creditReservations.id, reservation.id));
    if (cost > charged) {
      console.warn('[credits] reservation budget exceeded', {
        reservationId: reservation.id,
        actualCost: cost,
        charged
      });
    }
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
  const amount = creditAmount(params.amount, false);
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
      .returning({
        balance: sql<number>`${creditsAccounts.balance} - ${creditsAccounts.reserved}`,
        total: creditsAccounts.balance
      });
    await tx.insert(creditLedger).values({
      userId: params.userId,
      delta: amount,
      balanceAfter: account.total,
      kind: 'grant',
      meta: params.note ? { note: params.note } : null
    });
    return account.balance;
  });
}

/**
 * 直接设定余额（写调整流水，delta=新-旧）。可选 CLI 能力（set 子命令）。
 * SELECT ... FOR UPDATE 锁行：避免与并发结算交错导致 delta 失真 / 扣费被覆盖。
 * 返回设定后余额。
 */
export async function setBalance(params: {
  userId: string;
  amount: number;
  note?: string;
}): Promise<number> {
  const db = getDb();
  const target = creditAmount(params.amount, true);
  return db.transaction(async (tx) => {
    await tx
      .insert(creditsAccounts)
      .values({ userId: params.userId, balance: 0 })
      .onConflictDoNothing();
    const [current] = await tx
      .select({ balance: creditsAccounts.balance, reserved: creditsAccounts.reserved })
      .from(creditsAccounts)
      .where(eq(creditsAccounts.userId, params.userId))
      .for('update');
    const before = current.balance;
    const total = target + current.reserved;
    creditAmount(total, true);
    const [updated] = await tx
      .update(creditsAccounts)
      .set({ balance: total, updatedAt: new Date() })
      .where(eq(creditsAccounts.userId, params.userId))
      .returning({ balanceAfter: creditsAccounts.balance });
    await tx.insert(creditLedger).values({
      userId: params.userId,
      delta: total - before,
      balanceAfter: updated.balanceAfter,
      kind: 'grant',
      meta: { note: params.note ?? 'set', before, after: total }
    });
    return target;
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
