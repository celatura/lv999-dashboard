import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import SignInViewPage from '@/features/auth/components/sign-in-view';
import { sanitizeRedirectTarget } from '@/features/auth/lib/redirect-target';
import { verifySession } from '@/lib/auth-session';

export const metadata: Metadata = {
  title: '身份认证 | 登录',
  description: '用于身份认证的登录页面。'
};

interface PageProps {
  searchParams: Promise<{ redirect_url?: string | string[] }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const target = sanitizeRedirectTarget(
    typeof params.redirect_url === 'string' ? params.redirect_url : null
  );
  // 已登录访问登录页 → 直接回跳目标（避免登录态停留在登录页）
  const session = await verifySession();
  if (session) redirect(target);
  return <SignInViewPage redirectUrl={target} />;
}
