import type { Metadata } from 'next';
import ResetPasswordViewPage from '@/features/auth/components/reset-password-view';

export const metadata: Metadata = {
  title: '身份认证 | 重置密码',
  description: '设置你的新密码。'
};

interface PageProps {
  // 令牌由 Better Auth 回调重定向附加到 ?token=（服务端校验后跳转而来）
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;
  return <ResetPasswordViewPage token={token} />;
}
