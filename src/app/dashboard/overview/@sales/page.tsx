import { requireUserId } from '@/lib/auth-session';
import { getAssetStats } from '@/features/overview/api/service';
import { RecentCreations } from '@/features/overview/components/recent-sales';

export default async function Sales() {
  const userId = await requireUserId();
  const stats = await getAssetStats(userId);
  return <RecentCreations items={stats.recentAssets} />;
}
