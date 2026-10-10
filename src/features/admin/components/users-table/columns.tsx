'use client';

import type { Column, ColumnDef } from '@tanstack/react-table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DataTableColumnHeader } from '@/components/ui/table/data-table-column-header';
import { Icons } from '@/components/icons';
import { formatDateTime } from '@/features/agent/lib/format';
import { cn } from '@/lib/utils';
import type { DataTableFeatures } from '@/lib/data-table';
import type { AdminUser } from '../../api/types';
import { CellAction } from './cell-action';

/**
 * 用户管理列：用户（头像 + 名 + 邮箱，兼作搜索）/ 注册时间 / 最近登录 / Credits 余额 / 操作。
 * createdAt、lastSignInAt 可排序（映射服务端 orderBy）；query 列为文本搜索（ilike 模糊匹配）。
 */

/** 头像回退首字母：名称 → 邮箱 → '?' */
function initialsOf(user: AdminUser): string {
  const source = user.name || user.email || '?';
  return source.trim().charAt(0).toUpperCase() || '?';
}

function UserCell({ user }: { user: AdminUser }) {
  return (
    <div className='flex min-w-0 items-center gap-3'>
      <Avatar>
        <AvatarImage src={user.imageUrl} alt={user.name} />
        <AvatarFallback>{initialsOf(user)}</AvatarFallback>
      </Avatar>
      <div className='min-w-0'>
        <div className='truncate font-medium'>{user.name}</div>
        <div className='text-muted-foreground truncate text-xs'>{user.email}</div>
      </div>
    </div>
  );
}

export const columns: ColumnDef<DataTableFeatures, AdminUser>[] = [
  {
    id: 'query',
    accessorKey: 'name',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, AdminUser, unknown> }) => (
      <DataTableColumnHeader column={column} title='用户' />
    ),
    cell: ({ row }) => <UserCell user={row.original} />,
    meta: {
      label: '用户',
      placeholder: '搜索邮箱 / 名称…',
      variant: 'text' as const,
      icon: Icons.user
    },
    enableColumnFilter: true
  },
  {
    id: 'createdAt',
    accessorKey: 'createdAt',
    header: ({ column }: { column: Column<DataTableFeatures, AdminUser, unknown> }) => (
      <DataTableColumnHeader column={column} title='注册时间' />
    ),
    cell: ({ row }) => (
      <span className='text-muted-foreground text-sm'>
        {formatDateTime(row.original.createdAt)}
      </span>
    ),
    meta: { label: '注册时间' }
  },
  {
    id: 'lastSignInAt',
    accessorKey: 'lastSignInAt',
    header: ({ column }: { column: Column<DataTableFeatures, AdminUser, unknown> }) => (
      <DataTableColumnHeader column={column} title='最近登录' />
    ),
    cell: ({ row }) => {
      const value = row.original.lastSignInAt;
      return (
        <span className='text-muted-foreground text-sm'>
          {value ? formatDateTime(value) : '从未登录'}
        </span>
      );
    },
    meta: { label: '最近登录' }
  },
  {
    id: 'balance',
    accessorKey: 'balance',
    enableSorting: false,
    header: ({ column }: { column: Column<DataTableFeatures, AdminUser, unknown> }) => (
      <DataTableColumnHeader column={column} title='Credits 余额' />
    ),
    cell: ({ row }) => (
      <span
        className={cn(
          'text-sm font-medium tabular-nums',
          row.original.balance < 0 && 'text-destructive'
        )}
      >
        {row.original.balance}
      </span>
    ),
    meta: { label: 'Credits 余额' }
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
