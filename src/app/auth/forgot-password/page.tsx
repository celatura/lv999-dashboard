import type { Metadata } from 'next';
import ForgotPasswordViewPage from '@/features/auth/components/forgot-password-view';

export const metadata: Metadata = {
  title: '身份认证 | 忘记密码',
  description: '重置你的 LV999 账号密码。'
};

export default function Page() {
  return <ForgotPasswordViewPage />;
}
