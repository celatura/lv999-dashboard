import { AuthShell } from './auth-shell';
import { ForgotPasswordForm } from './forgot-password-form';

export default function ForgotPasswordViewPage() {
  return (
    <AuthShell>
      <ForgotPasswordForm />
    </AuthShell>
  );
}
