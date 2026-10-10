'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { parseAsArrayOf, parseAsInteger, parseAsString, useQueryStates } from 'nuqs';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { Skeleton } from '@/components/ui/skeleton';
import { useDataTable } from '@/hooks/use-data-table';
import { getSortingStateParser } from '@/lib/parsers';
import { knowledgeDocumentsQueryOptions } from '../../api/queries';
import type { KnowledgeDocumentFilters } from '../../api/types';
import { columns } from './columns';

const columnIds = columns.map((column) => column.id).filter(Boolean) as string[];

export function KnowledgeTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    title: parseAsString,
    status: parseAsArrayOf(parseAsString).withDefault([]),
    source: parseAsArrayOf(parseAsString).withDefault([]),
    sort: getSortingStateParser(columnIds).withDefault([])
  });

  // nuqs 默认 shallow:true：筛选/翻页走 URL 但不触发 RSC 往返，由 React Query 客户端取数
  const filters: KnowledgeDocumentFilters = {
    page: params.page,
    limit: params.perPage,
    ...(params.title && { search: params.title }),
    ...(params.status.length > 0 && { status: params.status.join(',') }),
    ...(params.source.length > 0 && { source: params.source.join(',') }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(knowledgeDocumentsQueryOptions(filters));
  const pageCount = Math.ceil(data.total / params.perPage);

  const { table } = useDataTable({
    data: data.documents,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { start: [], end: ['actions'] },
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
export function KnowledgeTableSkeleton() {
  return (
    <div className='flex flex-col gap-4'>
      <Skeleton className='h-9 w-full' />
      <Skeleton className='h-80 w-full' />
    </div>
  );
}
