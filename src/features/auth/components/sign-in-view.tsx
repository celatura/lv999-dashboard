import { AuthShell } from './auth-shell';
import { SignInForm } from './sign-in-form';

interface SignInViewPageProps {
  /** 登录成功后的回跳目标（页面服务端 sanitize 后传入） */
  redirectUrl: string;
}

export default function SignInViewPage({ redirectUrl }: SignInViewPageProps) {
  return (
    <AuthShell>
      <SignInForm redirectUrl={redirectUrl} />
    </AuthShell>
  );
}
