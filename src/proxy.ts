import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * 全站代理（Next.js proxy，Edge runtime）—— 仅做**乐观**会话分流，非安全边界。
 *
 * `getSessionCookie(request)` 只检查会话 cookie 是否存在（纯字符串解析，Edge 安全，
 * 不查 DB / 不验签），据此把未登录用户快速重定向到登录页并携带 `redirect_url` 以便登录后回跳。
 *
 * ⚠️ cookie 存在 ≠ 会话有效（可能过期/伪造）。**真实鉴权**在各 page / route 的
 * `verifySession()`（见 `lib/auth-session.ts`）：dashboard/layout 无有效会话会 redirect，
 * 各 API 路由 `requireUserId()` 为空返回 401。此处只负责 UX 分流，勿当安全边界。
 */
export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/sign-in';
    url.search = '';
    // 记录原始目标（相对路径），登录成功后回跳
    url.searchParams.set('redirect_url', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // 仅在进入受保护的 /dashboard 段时做乐观分流；API 路由各自 requireUserId 返回 401。
  matcher: ['/dashboard/:path*']
};
