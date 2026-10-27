import { getUserId } from '@/lib/auth-session';
import { redirect } from 'next/navigation';

export default async function Page() {
  const userId = await getUserId();

  if (!userId) {
    return redirect('/auth/sign-in');
  } else {
    redirect('/dashboard/overview');
  }
}
