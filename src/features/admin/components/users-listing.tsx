import { Suspense } from 'react';
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query-client';
import { searchParamsCache } from '@/lib/searchparams';
import { adminUsersQueryOptions } from '../api/queries';
import { listUsers } from '../api/service';
import type { AdminUserFilters } from '../api/types';
import { UsersTable, UsersTableSkeleton } from './users-table';

/**
 * 用户管理列表（server）：读 URL 状态 → 服务端预取（直连 service）→ HydrationBoundary + Suspense。
 * 预取 queryFn 直连 `listUsers`（查 user 表 + 合并余额），返回结构必须与客户端 `/api/admin/users`
 * 的 apiClient 应答完全一致，否则水合数据形状错乱。
 */
export default function UsersListing() {
  const query = searchParamsCache.get('query');
  const sort = searchParamsCache.get('sort');

  const filters: AdminUserFilters = {
    page: searchParamsCache.get('page'),
    limit: searchParamsCache.get('perPage'),
    ...(query && { query }),
    ...(sort && { sort })
  };

  const queryClient = getQueryClient();
  void queryClient.prefetchQuery({
    queryKey: adminUsersQueryOptions(filters).queryKey,
    queryFn: () => listUsers(filters)
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<UsersTableSkeleton />}>
        <UsersTable />
      </Suspense>
    </HydrationBoundary>
  );
}
