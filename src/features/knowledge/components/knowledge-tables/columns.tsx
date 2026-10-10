'use client';

import type { Column, ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Icons } from '@/components/icons';
import { formatDateTime } from '@/features/agent/lib/format';
import type { DataTableFeatures } from '@/lib/data-table';
import type { KnowledgeDocument } from '../../api/types';
import {
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  getSourceMeta,
  getStatusMeta
} from '../../constants/display';
import { CellAction } from './cell-action';

/** 标题单元格：资产导入的文档附「来自《xxx》」，来源资产已删则不显示 */
function TitleCell({ document }: { document: KnowledgeDocument }) {
  return (
    <div className='min-w-0'>
      <span className='block truncate font-medium'>{document.title}</span>
      {document.sourceAssetTitle && (
        <span className='text-muted-foreground mt-0.5 block truncate text-xs'>
          来自《{document.sourceAssetTitle}》
        </span>
      )}
    </div>
  );
}

export const columns: ColumnDef<DataTableFeatures, KnowledgeDocument>[] = [
  {
    id: 'title',
    accessorKey: 'title',
    header: ({ column }: { column: Column<DataTableFeatures, KnowledgeDocument, unknown> }) => (
      <DataTableColumnHeader column={column} title='标题' />
    ),
    cell: ({ row }) => <TitleCell document={row.original} />,
    meta: {
      label: '标题',
      placeholder: '搜索文档标题...',
      variant: 'text' as const,
      icon: Icons.text
    },
    enableColumnFilter: true
  },
  {
    id: 'status',
    accessorKey: 'status',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, KnowledgeDocument, unknown> }) => (
      <DataTableColumnHeader column={column} title='状态' />
    ),
    cell: ({ row }) => {
      const { label, icon: StatusIcon, variant } = getStatusMeta(row.original.status);
      return (
        <Badge variant={variant}>
          <StatusIcon
            className={row.original.status === 'processing' ? 'animate-spin' : undefined}
          />
          {label}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: '状态',
      variant: 'multiSelect' as const,
      options: STATUS_OPTIONS
    }
  },
  {
    id: 'source',
    accessorKey: 'source',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, KnowledgeDocument, unknown> }) => (
      <DataTableColumnHeader column={column} title='来源' />
    ),
    cell: ({ row }) => {
      const { label, icon: SourceIcon } = getSourceMeta(row.original.source);
      return (
        <Badge variant='outline'>
          <SourceIcon className='size-3' />
          {label}
        </Badge>
      );
    },
    enableColumnFilter: true,
    meta: {
      label: '来源',
      variant: 'multiSelect' as const,
      options: SOURCE_OPTIONS
    }
  },
  {
    id: 'chunkCount',
    accessorKey: 'chunkCount',
    header: ({ column }: { column: Column<DataTableFeatures, KnowledgeDocument, unknown> }) => (
      <DataTableColumnHeader column={column} title='片段数' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>{row.original.chunkCount}</span>
    ),
    meta: {
      label: '片段数'
    }
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }: { column: Column<DataTableFeatures, KnowledgeDocument, unknown> }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
    meta: {
      label: '创建时间'
    }
  },
  {
    id: 'actions',
    size: 48,
    cell: ({ row }) => (
      <div className='flex justify-center'>
        <CellAction data={row.original} />
      </div>
    )
  }
];
