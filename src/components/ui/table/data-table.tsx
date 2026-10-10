import { type RowData, type Table, flexRender } from '@tanstack/react-table';
import type * as React from 'react';

import { DataTablePagination } from '@/components/ui/table/data-table-pagination';
import {
  Table as TableUI,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { type DataTableFeatures, getCommonPinningStyles } from '@/lib/data-table';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface DataTableProps<TData extends RowData> extends React.ComponentProps<'div'> {
  table: Table<DataTableFeatures, TData>;
  actionBar?: React.ReactNode;
}

export function DataTable<TData extends RowData>({
  table,
  actionBar,
  children
}: DataTableProps<TData>) {
  return (
    <div className='flex flex-col space-y-4'>
      {children}
      {/* 框高贴合内容：留白留在框外（画布呼吸），而非框内空洞；横向溢出时内部滚动 */}
      <div className='overflow-hidden rounded-lg border'>
        <ScrollArea className='w-full'>
          <TableUI>
            <TableHeader className='bg-muted sticky top-0 z-10'>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      style={{
                        ...getCommonPinningStyles({ column: header.column })
                      }}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        style={{
                          ...getCommonPinningStyles({ column: cell.column })
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={table.getAllColumns().length} className='h-24 text-center'>
                    暂无匹配数据
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </TableUI>
          <ScrollBar orientation='horizontal' />
        </ScrollArea>
      </div>
      <div className='flex flex-col gap-2.5'>
        {actionBar && table.getFilteredSelectedRowModel().rows.length > 0 && actionBar}
        <DataTablePagination table={table} />
      </div>
    </div>
  );
}
