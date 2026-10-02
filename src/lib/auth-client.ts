import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth React 客户端（浏览器侧）。
 *
 * - 未显式配 baseURL：与 API 同源，客户端默认按 `window.location.origin` 请求 `/api/auth/*`，
 *   由 `app/api/auth/[...all]` 路由处理（避免跨域与 origin 不匹配）。
 * - 不传服务端 auth 泛型：本 MVP 无插件、无自定义 user/session 字段，核心邮箱密码方法
 *   （signIn.email / signUp.email / signOut / useSession / updateUser / changePassword /
 *   requestPasswordReset / resetPassword）在无泛型时即完整具备类型。未来若加插件，
 *   改用 `createAuthClient<{ $InferAuth: typeof auth.options }>()`（`import type { auth }`）补全推断。
 *
 * 认证写操作（登录/注册/登出/改资料/改密码/重置）全部经此客户端走 HTTP 路由；
 * 服务端会话**读取**另走 `lib/auth-session.ts`（DAL），二者职责分离。
 */
export const authClient = createAuthClient();

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  updateUser,
  changePassword,
  requestPasswordReset,
  resetPassword
} = authClient;

/** 客户端会话类型（含 user），供组件标注 props / state */
export type ClientSession = typeof authClient.$Infer.Session;
