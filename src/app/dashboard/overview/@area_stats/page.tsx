import { requireUserId } from '@/lib/auth-session';
import { getAssetStats } from '@/features/overview/api/service';
import { AreaGraph } from '@/features/overview/components/area-graph';

export default async function AreaStats() {
  const userId = await requireUserId();
  const stats = await getAssetStats(userId);
  return <AreaGraph dailyTrend={stats.dailyTrend} />;
}
