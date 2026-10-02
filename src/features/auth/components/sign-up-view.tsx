import { AuthShell } from './auth-shell';
import { SignUpForm } from './sign-up-form';

interface SignUpViewPageProps {
  /** 注册成功后的回跳目标（页面服务端 sanitize 后传入） */
  redirectUrl: string;
}

export default function SignUpViewPage({ redirectUrl }: SignUpViewPageProps) {
  return (
    <AuthShell>
      <SignUpForm redirectUrl={redirectUrl} />
    </AuthShell>
  );
}
