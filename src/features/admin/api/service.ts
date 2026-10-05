import { count, eq, ilike, inArray, max, or, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { session, user } from '@/lib/db/auth-schema';
import {
  assets,
  conversations,
  creditLedger,
  creditsAccounts,
  knowledgeChunks,
  knowledgeDocuments,
  messages,
  skills
} from '@/lib/db/schema';
import { getOssServerClient } from '@/lib/oss';
import { getBalancesByIds } from '@/features/credits/api/service';
import type { AdminUser, AdminUserFilters, AdminUsersResponse, DeleteUserResult } from './types';

/**
 * 管理员用户管理数据访问层（server-only）。
 *
 * - 列用户：查 Better Auth `user` 表（分页 + 搜索 email/name/id + 排序）+ 合并项目 `credits_accounts`
 *   余额（批量查，避免 N+1）；「最近登录」由 `session` 表派生（user 表无 lastSignInAt 列）。
 * - 删用户：先删 Better Auth 用户（级联 session/account 断登录）→ DB 事务级联清理业务表 → OSS 对象清理（失败仅告警）。
 * - 调 Credits：不在本文件重写，路由直接复用 `features/credits` 的 grantCredits / setBalance。
 *
 * 客户端经 `/api/admin/*` Route Handlers 访问（每个端点 isAdmin 403 守卫），不直接引用本文件。
 */

/** listUsers 查询投影的一行（Better Auth user + 派生的最近登录时间） */
interface UserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  createdAt: Date;
  lastSignInAt: Date | null;
}

/** 展示名：user.name 优先，缺省回退邮箱前缀或 userId */
function resolveName(row: UserRow): string {
  const name = row.name?.trim();
  if (name) return name;
  if (row.email) return row.email.split('@')[0] || row.id;
  return row.id;
}

function toAdminUser(row: UserRow, balance: number): AdminUser {
  return {
    id: row.id,
    name: resolveName(row),
    email: row.email || '（无邮箱）',
    imageUrl: row.image ?? '',
    createdAt: row.createdAt.toISOString(),
    // max(session.createdAt) 经 leftJoin 未命中（从未登录）时为 null；用 instanceof 兜底运行时安全
    lastSignInAt: row.lastSignInAt instanceof Date ? row.lastSignInAt.toISOString() : null,
    balance
  };
}

/**
 * 解析前端排序参数：`sort` 为 JSON 字符串 `[{ id, desc }]`，仅取首列。
 * 支持 createdAt / lastSignInAt；其余或非法输入回退默认 createdAt 倒序。
 */
function parseSort(sort?: string): { column: 'createdAt' | 'lastSignInAt'; descending: boolean } {
  let column: 'createdAt' | 'lastSignInAt' = 'createdAt';
  let descending = true;
  if (sort) {
    try {
      const parsed = JSON.parse(sort) as { id?: string; desc?: boolean }[];
      const first = Array.isArray(parsed) ? parsed[0] : undefined;
      if (first?.id === 'lastSignInAt') column = 'lastSignInAt';
      if (first) descending = first.desc !== false;
    } catch {
      // 非法 sort → 默认排序
    }
  }
  return { column, descending };
}

/** 用户列表：查 Better Auth user 表（分页 + 搜索 + 排序）+ 合并 Credits 余额（一次批量查，避免 N+1） */
export async function listUsers(filters: AdminUserFilters): Promise<AdminUsersResponse> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 10));
  const offset = (page - 1) * limit;
  const query = filters.query?.trim();
  const db = getDb();

  // 每用户最近一次会话创建时间 = 最近登录（user 表无 lastSignInAt 列，从 session 派生）。
  // 注意：聚合字段 max(...) 必须单独 .as('别名')，否则外层子查询无法按名引用该 raw SQL 列。
  const lastActive = db
    .select({
      userId: session.userId,
      lastSignInAt: max(session.createdAt).as('last_sign_in_at')
    })
    .from(session)
    .groupBy(session.userId)
    .as('last_active');

  const where = query
    ? or(
        ilike(user.email, `%${query}%`),
        ilike(user.name, `%${query}%`),
        ilike(user.id, `%${query}%`)
      )
    : undefined;

  const { column, descending } = parseSort(filters.sort);
  const orderTarget = column === 'lastSignInAt' ? lastActive.lastSignInAt : user.createdAt;
  // lastSignInAt 由 leftJoin 派生可能为 null（从未登录）：排序一律 NULLS LAST，避免新用户顶在列表最前
  const orderBy = descending
    ? sql`${orderTarget} DESC NULLS LAST`
    : sql`${orderTarget} ASC NULLS LAST`;

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        createdAt: user.createdAt,
        lastSignInAt: lastActive.lastSignInAt
      })
      .from(user)
      .leftJoin(lastActive, eq(lastActive.userId, user.id))
      .where(where)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(user).where(where)
  ]);

  const balances = await getBalancesByIds(rows.map((row) => row.id));
  const users = rows.map((row) => toAdminUser(row, balances.get(row.id) ?? 0));
  return { users, total: totalRows[0]?.value ?? 0, page, limit };
}

/**
 * 级联删除用户（不可逆重操作）。顺序：DB 事务原子清库 → 提交后清对象存储。
 *
 * 1. **DB 事务（原子）**：先删 Better Auth `user`（`session` / `account` 外键 ON DELETE CASCADE → 断登录），
 *    再按 userId 清理业务 8 表；任一步失败整体回滚（用户行保留，可安全重跑）。已删则 user 影响 0 行，幂等继续。
 *    先收集 assets 的 storageKey 与预数 messages——`messages` 无 userId 列，靠 `conversations` 的
 *    ON DELETE CASCADE 清理；`knowledgeChunks` 显式按 userId 删 + `knowledgeDocuments` 的 CASCADE 兜底；
 *    `skills` 亦按 userId 显式删（该表无外键指向 auth user，不会被级联）；其余表跨表外键均 cascade / set null。
 * 2. **OSS 清理**：事务提交后并发删除步骤 1 收集的 storageKey（固定并发分批），失败仅 `console.warn`
 *    不阻塞（DB 行已删，残留对象无访问路径，沿用 deleteAsset 模式）。
 */
export async function deleteUserCascade(userId: string): Promise<DeleteUserResult> {
  const db = getDb();

  // DB 事务：删用户（级联断登录）+ 清业务 8 表，全部原子——失败整体回滚，用户行保留可重跑
  const { storageKeys, counts } = await db.transaction(async (tx) => {
    // 1. 删 Better Auth 用户（FK cascade 清 session/account → 断登录）；已删则 0 行，幂等继续
    await tx.delete(user).where(eq(user.id, userId));

    const convRows = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.userId, userId));
    const convIds = convRows.map((row) => row.id);
    const assetRows = await tx
      .select({ storageKey: assets.storageKey })
      .from(assets)
      .where(eq(assets.userId, userId));

    // messages 无 userId 列：删 conversations 前先按其 id 计数（cascade 删除本身不回传被级联行数）
    const [msgRow] =
      convIds.length > 0
        ? await tx
            .select({ value: count() })
            .from(messages)
            .where(inArray(messages.conversationId, convIds))
        : [{ value: 0 }];

    const skillsDel = await tx
      .delete(skills)
      .where(eq(skills.userId, userId))
      .returning({ id: skills.id });
    const chunks = await tx
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.userId, userId))
      .returning({ id: knowledgeChunks.id });
    const docs = await tx
      .delete(knowledgeDocuments)
      .where(eq(knowledgeDocuments.userId, userId))
      .returning({ id: knowledgeDocuments.id });
    const assetsDel = await tx
      .delete(assets)
      .where(eq(assets.userId, userId))
      .returning({ id: assets.id });
    const convs = await tx
      .delete(conversations)
      .where(eq(conversations.userId, userId))
      .returning({ id: conversations.id });
    const ledger = await tx
      .delete(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .returning({ id: creditLedger.id });
    const accounts = await tx
      .delete(creditsAccounts)
      .where(eq(creditsAccounts.userId, userId))
      .returning({ userId: creditsAccounts.userId });

    return {
      storageKeys: assetRows
        .map((row) => row.storageKey)
        .filter((key): key is string => Boolean(key)),
      counts: {
        conversations: convs.length,
        messages: msgRow?.value ?? 0,
        assets: assetsDel.length,
        skills: skillsDel.length,
        knowledgeDocuments: docs.length,
        knowledgeChunks: chunks.length,
        creditLedger: ledger.length,
        creditsAccounts: accounts.length
      }
    };
  });

  // 2. OSS 清理（事务提交后；失败仅告警不阻塞：DB 行已删，残留对象无访问路径）；各对象互不依赖，
  // 按固定并发分批删除（单请求内复用同一 client，避免每 key 新建一次）
  const oss = getOssServerClient();
  const OSS_DELETE_CONCURRENCY = 8;
  const deleteBatches = await Promise.all(
    Array.from({ length: Math.ceil(storageKeys.length / OSS_DELETE_CONCURRENCY) }, (_, batch) =>
      Promise.all(
        storageKeys
          .slice(batch * OSS_DELETE_CONCURRENCY, (batch + 1) * OSS_DELETE_CONCURRENCY)
          .map(async (key) => {
            try {
              await oss.delete(key);
              return true;
            } catch (error) {
              console.warn('[admin] failed to delete OSS object:', { key, error });
              return false;
            }
          })
      )
    )
  );
  const ossObjects = deleteBatches.flat().filter(Boolean).length;

  return { ...counts, ossObjects };
}
