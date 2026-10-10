'use client';

import type { RowData, Table } from '@tanstack/react-table';
import { Icons } from '@/components/icons';
import type { DataTableFeatures } from '@/lib/data-table';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface DataTableViewOptionsProps<TData extends RowData> {
  table: Table<DataTableFeatures, TData>;
}

export function DataTableViewOptions<TData extends RowData>({
  table
}: DataTableViewOptionsProps<TData>) {
  const columns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter((column) => typeof column.accessorFn !== 'undefined' && column.getCanHide()),
    [table]
  );

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label='切换列'
            variant='outline'
            size='sm'
            className='ml-auto hidden h-8 lg:flex'
          />
        }
      >
        <Icons.adjustments />
        视图
        <Icons.chevronsUpDown className='ml-auto opacity-50' />
      </PopoverTrigger>
      <PopoverContent align='end' className='w-44 p-0'>
        <Command>
          <CommandInput placeholder='搜索列...' />
          <CommandList>
            <CommandEmpty>未找到列。</CommandEmpty>
            <CommandGroup>
              {columns.map((column) => (
                <CommandItem
                  key={column.id}
                  onSelect={() => column.toggleVisibility(!column.getIsVisible())}
                >
                  <span className='truncate'>{column.columnDef.meta?.label ?? column.id}</span>
                  <Icons.check
                    className={cn(
                      'ml-auto size-4 shrink-0',
                      column.getIsVisible() ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
