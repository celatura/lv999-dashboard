'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';
import { adminUsersQueryOptions } from '../../api/queries';
import type { AdminUserFilters } from '../../api/types';
import { columns } from './columns';

const columnIds = columns.map((column) => column.id).filter(Boolean) as string[];

export function UsersTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    query: parseAsString,
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  // nuqs 默认 shallow:true：搜索/翻页走 URL 但不触发 RSC 往返，由 React Query 客户端取数
  const filters: AdminUserFilters = {
    page: params.page,
    limit: params.perPage,
    ...(params.query && { query: params.query }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(adminUsersQueryOptions(filters));
  const pageCount = Math.ceil(data.total / params.perPage);

  const { table } = useDataTable({
    data: data.users,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { right: ['actions'] },
      // 与服务端默认排序（createdAt 倒序）一致，表头显示降序指示
      sorting: [{ id: 'createdAt', desc: true }]
    }
  });

  return (
    <DataTable table={table}>
      <DataTableToolbar table={table} />
    </DataTable>
  );
}

/** Suspense 回退：客户端导航且缓存为空时展示（服务端已预取时不会出现） */
export function UsersTableSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-80 w-full' />
    </div>
  );
}
