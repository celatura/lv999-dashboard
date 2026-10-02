import { AuthShell } from './auth-shell';
import { ResetPasswordForm } from './reset-password-form';

interface ResetPasswordViewPageProps {
  /** 重置令牌（由页面从 ?token= 读取后传入；缺失/无效时表单展示提示） */
  token: string | null;
}

export default function ResetPasswordViewPage({ token }: ResetPasswordViewPageProps) {
  return (
    <AuthShell>
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
