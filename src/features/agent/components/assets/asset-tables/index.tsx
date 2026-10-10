'use client';

import { useState } from 'react';
import { DataTable } from '@/components/ui/table/data-table';
import { DataTableToolbar } from '@/components/ui/table/data-table-toolbar';
import { AlertModal } from '@/components/modal/alert-modal';
import { Button } from '@/components/ui/button';
import { Icons } from '@/components/icons';
import { useDataTable } from '@/hooks/use-data-table';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import type { Table } from '@tanstack/react-table';
import type { DataTableFeatures } from '@/lib/data-table';
import {
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates
} from 'nuqs';
import { toast } from 'sonner';
import { getSortingStateParser } from '@/lib/parsers';
import { batchDeleteAssetsMutation } from '../../../api/mutations';
import { assetsQueryOptions } from '../../../api/queries';
import type { Asset, AssetFilters } from '../../../api/types';
import { columns } from './columns';

const columnIds = columns.map((column) => column.id).filter(Boolean) as string[];

export function AssetsTable() {
  const [params] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    perPage: parseAsInteger.withDefault(10),
    title: parseAsString,
    kind: parseAsArrayOf(parseAsString).withDefault([]),
    favorite: parseAsBoolean,
    sort: getSortingStateParser(columnIds).withDefault([])
  });
  // nuqs 默认 shallow:true：收藏筛选走 URL 但不触发 RSC 往返，由 React Query 客户端取数
  const [, setFavoriteParam] = useQueryState('favorite', parseAsBoolean);

  const filters: AssetFilters = {
    page: params.page,
    limit: params.perPage,
    ...(params.title && { search: params.title }),
    ...(params.kind.length > 0 && { kind: params.kind.join(',') }),
    ...(params.favorite !== null && { favorite: params.favorite }),
    ...(params.sort.length > 0 && { sort: JSON.stringify(params.sort) })
  };

  const { data } = useSuspenseQuery(assetsQueryOptions(filters));
  const pageCount = Math.ceil(data.total / params.perPage);

  const { table } = useDataTable({
    data: data.assets,
    columns,
    pageCount,
    shallow: true,
    debounceMs: 500,
    initialState: {
      columnPinning: { start: [], end: ['favorite', 'actions'] },
      sorting: [{ id: 'createdAt', desc: true }]
    }
  });

  return (
    <DataTable table={table} actionBar={<BatchActionBar table={table} />}>
      <DataTableToolbar table={table}>
        <Button
          variant={params.favorite ? 'default' : 'outline'}
          size='sm'
          className='h-8'
          aria-pressed={params.favorite === true}
          onClick={() => {
            table.resetRowSelection();
            void setFavoriteParam(params.favorite ? null : true);
          }}
        >
          <Icons.star className={params.favorite ? 'fill-current' : undefined} />
          仅看收藏
        </Button>
      </DataTableToolbar>
    </DataTable>
  );
}

/** 选中行后浮出的批量操作条：当前仅批量删除（AlertModal 二次确认） */
function BatchActionBar({ table }: { table: Table<DataTableFeatures, Asset> }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const batchDeleteMutation = useMutation(batchDeleteAssetsMutation);

  const selectedRows = table.getFilteredSelectedRowModel().rows;
  const selectedCount = selectedRows.length;
  const isDeleting = batchDeleteMutation.isPending;

  return (
    <>
      <AlertModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() =>
          batchDeleteMutation.mutate(
            selectedRows.map((row) => row.original.id),
            {
              onSuccess: ({ deleted }) => {
                toast.success(`已删除 ${deleted} 个资产`);
                setConfirmOpen(false);
                table.resetRowSelection();
              },
              onError: () => toast.error('批量删除失败，请稍后重试')
            }
          )
        }
        loading={isDeleting}
        title={`删除选中的 ${selectedCount} 个资产？`}
        description='将同时清理文件存储，此操作不可撤销。'
        confirmLabel='删除'
      />
      <div className='bg-background flex w-full items-center justify-between rounded-md border px-4'>
        <div className='text-muted-foreground h-12 flex-1 text-sm'>
          已选中 <span className='text-foreground font-medium'>{selectedCount}</span> 项
        </div>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={isDeleting}
            onClick={() => table.resetRowSelection()}
          >
            取消选择
          </Button>
          <Button
            variant='destructive'
            size='sm'
            disabled={isDeleting}
            onClick={() => setConfirmOpen(true)}
          >
            {isDeleting ? <Icons.spinner className='animate-spin' /> : <Icons.trash />}
            删除
          </Button>
        </div>
      </div>
    </>
  );
}
