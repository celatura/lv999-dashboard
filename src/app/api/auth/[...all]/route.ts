import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth';

// Better Auth 依赖 Node 原生 crypto（scrypt 密码哈希），必须 nodejs runtime。
export const runtime = 'nodejs';

// 统一挂载 Better Auth 全部端点（/api/auth/sign-in/email、/sign-up/email、
// /get-session、/sign-out、/request-password-reset、/reset-password 等）到此 catch-all 路由。
export const { GET, POST } = toNextJsHandler(auth);
