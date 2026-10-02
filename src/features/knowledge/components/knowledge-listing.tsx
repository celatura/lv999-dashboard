import { Suspense } from 'react';
import { requireUserId } from '@/lib/auth-session';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { knowledgeDocumentsQueryOptions } from '../api/queries';
import { listDocuments } from '../api/service';
import type { KnowledgeDocumentFilters } from '../api/types';
import { KnowledgeTable, KnowledgeTableSkeleton } from './knowledge-tables';

export default async function KnowledgeListing() {
  const userId = await requireUserId();
  if (!userId) return null;

  const title = searchParamsCache.get('title');
  const status = searchParamsCache.get('status');
  const source = searchParamsCache.get('source');
  const sort = searchParamsCache.get('sort');

  const filters: KnowledgeDocumentFilters = {
    page: searchParamsCache.get('page'),
    limit: searchParamsCache.get('perPage'),
    ...(title && { search: title }),
    ...(status && { status }),
    ...(source && { source }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  // 预取 queryFn 直连 service（服务端），返回结构必须与客户端 apiClient 完全一致，
  // 否则水合数据形状错乱（历史事故）
  void queryClient.prefetchQuery({
    queryKey: knowledgeDocumentsQueryOptions(filters).queryKey,
    queryFn: () => listDocuments(userId, filters)
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<KnowledgeTableSkeleton />}>
        <KnowledgeTable />
      </Suspense>
    </HydrationBoundary>
  );
}
