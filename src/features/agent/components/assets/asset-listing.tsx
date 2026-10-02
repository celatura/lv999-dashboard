import { requireUserId } from '@/lib/auth-session';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { assetsQueryOptions } from '../../api/queries';
import { listAssets } from '../../api/service';
import type { AssetFilters } from '../../api/types';
import { AssetsTable } from './asset-tables';

export default async function AssetListingPage() {
  const userId = await requireUserId();
  if (!userId) return null;

  const page = searchParamsCache.get('page');
  const limit = searchParamsCache.get('perPage');
  const title = searchParamsCache.get('title');
  const kind = searchParamsCache.get('kind');
  const favorite = searchParamsCache.get('favorite');
  const sort = searchParamsCache.get('sort');

  const filters: AssetFilters = {
    page,
    limit,
    ...(title && { search: title }),
    ...(kind && { kind }),
    ...(favorite !== null && { favorite }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery({
    queryKey: assetsQueryOptions(filters).queryKey,
    queryFn: () => listAssets(userId, filters)
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AssetsTable />
    </HydrationBoundary>
  );
}
