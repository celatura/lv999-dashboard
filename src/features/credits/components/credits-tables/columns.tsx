'use client';

import type { Column, ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { formatDateTime } from '@/features/agent/lib/format';
import { cn } from '@/lib/utils';
import type { DataTableFeatures } from '@/lib/data-table';
import type { LedgerEntry } from '../../api/types';
import { KIND_OPTIONS, describeLedgerMeta, getCreditKindMeta } from '../../constants/display';

/**
 * Credits 流水列：时间 / 类型徽标 / 变动（±，颜色区分）/ 变动后余额 / 详情（meta 摘要）。
 * delta、balanceAfter、createdAt 可排序（服务端 listLedger 支持）；类型可 multiSelect 筛选。
 */
export const columns: ColumnDef<DataTableFeatures, LedgerEntry>[] = [
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }: { column: Column<DataTableFeatures, LedgerEntry, unknown> }) => (
      <DataTableColumnHeader column={column} title='时间' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
    meta: { label: '时间' }
  },
  {
    id: 'kind',
    accessorKey: 'kind',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, LedgerEntry, unknown> }) => (
      <DataTableColumnHeader column={column} title='类型' />
    ),
    cell: ({ row }) => {
      const { label, icon: KindIcon } = getCreditKindMeta(row.original.kind);
      return (
        <Badge variant='outline'>
          <KindIcon className='size-3' />
          {label}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: '类型',
      variant: 'multiSelect' as const,
      options: KIND_OPTIONS
    }
  },
  {
    id: 'delta',
    accessorKey: 'delta',
    header: ({ column }: { column: Column<DataTableFeatures, LedgerEntry, unknown> }) => (
      <DataTableColumnHeader column={column} title='变动' />
    ),
    cell: ({ row }) => {
      const delta = row.original.delta;
      const positive = delta > 0;
      return (
        <span
          className={cn(
            'text-sm font-medium tabular-nums',
            positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'
          )}
        >
          {positive ? '+' : ''}
          {delta}
        </span>
      );
    },
    meta: { label: '变动' }
  },
  {
    id: 'balanceAfter',
    accessorKey: 'balanceAfter',
    header: ({ column }: { column: Column<DataTableFeatures, LedgerEntry, unknown> }) => (
      <DataTableColumnHeader column={column} title='变动后余额' />
    ),
    cell: ({ row }) => (
      <span
        className={cn('text-sm tabular-nums', row.original.balanceAfter < 0 && 'text-destructive')}
      >
        {row.original.balanceAfter}
      </span>
    ),
    meta: { label: '变动后余额' }
  },
  {
    id: 'detail',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, LedgerEntry, unknown> }) => (
      <DataTableColumnHeader column={column} title='详情' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {describeLedgerMeta(row.original.kind, row.original.meta)}
      </span>
    ),
    meta: { label: '详情' }
  }
];
