import { getUserId } from '@/lib/auth-session';
import { getAssetStats } from '@/features/overview/api/service';
import { PieGraph } from '@/features/overview/components/pie-graph';

export default async function Stats() {
  const userId = await getUserId();
  const stats = await getAssetStats(userId);
  return <PieGraph kindCounts={stats.kindCounts} />;
}
