import type { RowData, Table } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import type { DataTableFeatures } from '@/lib/data-table';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface DataTablePaginationProps<TData extends RowData> extends React.ComponentProps<'div'> {
  table: Table<DataTableFeatures, TData>;
  pageSizeOptions?: number[];
}

export function DataTablePagination<TData extends RowData>({
  table,
  pageSizeOptions = [10, 20, 30, 40, 50],
  className,
  ...props
}: DataTablePaginationProps<TData>) {
  return (
    <div
      className={cn(
        'flex w-full flex-wrap items-center justify-between gap-2 overflow-auto p-1 sm:gap-8',
        className
      )}
      {...props}
    >
      <div className='text-muted-foreground text-sm whitespace-nowrap'>
        {table.getFilteredSelectedRowModel().rows.length > 0 ? (
          <>
            已选 {table.getFilteredSelectedRowModel().rows.length} /{' '}
            {table.getFilteredRowModel().rows.length} 项
          </>
        ) : (
          <>共 {table.getFilteredRowModel().rows.length} 项</>
        )}
      </div>
      <div className='flex items-center gap-2 sm:gap-6 lg:gap-8'>
        <div className='hidden items-center space-x-2 sm:flex'>
          <p className='text-sm font-medium whitespace-nowrap'>每页行数</p>
          <Select
            value={`${table.store.state.pagination.pageSize}`}
            onValueChange={(value) => {
              table.setPageSize(Number(value));
            }}
          >
            <SelectTrigger className='h-8 w-[4.5rem] [&[data-size]]:h-8'>
              <SelectValue placeholder={table.store.state.pagination.pageSize} />
            </SelectTrigger>
            <SelectContent side='top'>
              <SelectGroup>
                {pageSizeOptions.map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className='flex items-center justify-center text-sm font-medium whitespace-nowrap'>
          第 {table.store.state.pagination.pageIndex + 1} / {table.getPageCount()} 页
        </div>
        <div className='flex items-center space-x-1'>
          <Button
            aria-label='第一页'
            variant='outline'
            size='icon'
            className='hidden size-8 lg:flex'
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            <Icons.chevronsLeft />
          </Button>
          <Button
            aria-label='上一页'
            variant='outline'
            size='icon'
            className='size-8'
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <Icons.chevronLeft />
          </Button>
          <Button
            aria-label='下一页'
            variant='outline'
            size='icon'
            className='size-8'
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <Icons.chevronRight />
          </Button>
          <Button
            aria-label='最后一页'
            variant='outline'
            size='icon'
            className='hidden size-8 lg:flex'
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            <Icons.chevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
