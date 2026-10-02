import { Suspense } from 'react';
import { requireUserId } from '@/lib/auth-session';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { ledgerQueryOptions } from '../api/queries';
import { listLedger } from '../api/service';
import type { LedgerFilters } from '../api/types';
import { CreditsBalanceBanner } from './credits-balance-banner';
import { CreditsTable, CreditsTableSkeleton } from './credits-tables';

export default async function CreditsListing() {
  const userId = await requireUserId();
  if (!userId) return null;

  const kind = searchParamsCache.get('kind');
  const sort = searchParamsCache.get('sort');

  const filters: LedgerFilters = {
    page: searchParamsCache.get('page'),
    limit: searchParamsCache.get('perPage'),
    ...(kind && { kind }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  // 预取 queryFn 直连 service（服务端），返回结构必须与客户端 apiClient 完全一致，
  // 否则水合数据形状错乱（历史事故）
  void queryClient.prefetchQuery({
    queryKey: ledgerQueryOptions(filters).queryKey,
    queryFn: () => listLedger(userId, filters)
  });

  return (
    <div className='flex flex-col gap-4'>
      <CreditsBalanceBanner />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <Suspense fallback={<CreditsTableSkeleton />}>
          <CreditsTable />
        </Suspense>
      </HydrationBoundary>
    </div>
  );
}
