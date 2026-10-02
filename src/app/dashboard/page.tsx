import { requireUserId } from '@/lib/auth-session';
import { redirect } from 'next/navigation';

export default async function Dashboard() {
  const userId = await requireUserId();

  if (!userId) {
    return redirect('/auth/sign-in');
  } else {
    redirect('/dashboard/overview');
  }
}
