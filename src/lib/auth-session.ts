import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { auth, type Session } from '@/lib/auth';

/**
 * 认证 Data Access Layer（DAL，server-only）—— 全站会话读取的**单一入口**。
 *
 * 取代此前散落在 ~33 个 Route Handler / server 页 / listing 里的 Clerk `auth()` 调用：
 * 所有服务端代码统一经 `verifySession()` / `requireUserId()` 取当前用户，未来更换认证实现
 * 或加缓存只改这一处（官方 DAL 最佳实践）。
 *
 * - `verifySession()`：`auth.api.getSession({ headers })` + React `cache()` 去重——
 *   同一请求内多次调用只查一次（cookieCache 命中时甚至不查 DB）。
 * - `requireUserId()`：只取 userId，未登录返回 `null`（**不抛错**）——
 *   刻意保留 `null` 语义，让调用方原有的 `if (!userId) return apiError(401, …)` /
 *   `if (!userId) return null` / `if (!userId) notFound()` 分支逐字不变，401 信封语义完全一致。
 *
 * 注意：本层仅**读取**会话（getSession），不写 cookie；认证写操作走客户端 `lib/auth-client.ts`
 * 经 `/api/auth/[...all]` 路由完成，故在 RSC 中调用本层不会触发「无法在 RSC 写 cookie」错误。
 */

/** 当前登录用户（Better Auth user 行：id/name/email/image/emailVerified/createdAt/updatedAt） */
export type AuthUser = Session['user'];
/** 当前会话（Better Auth session 行） */
export type AuthSession = Session['session'];

export interface VerifiedSession {
  userId: string;
  user: AuthUser;
  session: AuthSession;
}

/**
 * 校验当前请求会话。已登录返回 `{ userId, user, session }`，未登录返回 `null`。
 * React `cache()` 保证同一请求内去重（Route Handler / RSC 均生效）。
 */
export const verifySession = cache(async (): Promise<VerifiedSession | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  return { userId: session.user.id, user: session.user, session: session.session };
});

/**
 * 取当前登录 userId；未登录返回 `null`（由调用方映射为 401 / notFound / 空渲染）。
 * 语义等价于原 `const { userId } = await auth()`，可逐处机械替换。
 */
export async function requireUserId(): Promise<string | null> {
  const verified = await verifySession();
  return verified?.userId ?? null;
}

/**
 * 强制回源 DB 的会话读取（绕过 cookieCache ≤maxAge 窗口）：用于「吊销即时性」敏感的判权
 * （管理端端点、扣费写操作等）——被删用户 / 已 `revokeSessionsOnPasswordReset` 的旧 cookie
 * 立即失效，不受 ≤60s 缓存窗口影响。普通只读列表仍用 `verifySession()` 享受缓存。
 */
export const verifySessionAuthoritative = cache(async (): Promise<VerifiedSession | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true }
  });
  if (!session) return null;
  return { userId: session.user.id, user: session.user, session: session.session };
});

/** 同 requireUserId，但强制回源 DB（敏感判权 / 扣费写路径用）。 */
export async function requireUserIdAuthoritative(): Promise<string | null> {
  const verified = await verifySessionAuthoritative();
  return verified?.userId ?? null;
}
