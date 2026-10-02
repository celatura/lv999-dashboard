import { requireUserId } from '@/lib/auth-session';
import { getAssetStats } from '@/features/overview/api/service';
import { BarGraph } from '@/features/overview/components/bar-graph';

export default async function BarStats() {
  const userId = await requireUserId();
  const stats = await getAssetStats(userId);
  return <BarGraph dailyTrend={stats.dailyTrend} />;
}
