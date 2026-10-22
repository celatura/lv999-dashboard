'use client';

import {
  type ColumnFiltersState,
  type ColumnPinningState,
  type ColumnVisibilityState,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
  useTable
} from '@tanstack/react-table';
import {
  type Parser,
  type UseQueryStateOptions,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
  useQueryStates
} from 'nuqs';
import * as React from 'react';

import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { type DataTableFeatures, dataTableFeatures } from '@/lib/data-table';
import { getSortingStateParser } from '@/lib/parsers';
import type { DataTableColumnMeta, ExtendedColumnSort } from '@/types/data-table';

const PAGE_KEY = 'page';
const PER_PAGE_KEY = 'perPage';
const SORT_KEY = 'sort';
const ARRAY_SEPARATOR = ',';
const DEBOUNCE_MS = 300;
const THROTTLE_MS = 50;

const MULTI_VALUE_FILTER_VARIANTS = new Set<string>([
  'select',
  'multiSelect',
  'range',
  'dateRange'
]);

function getIsMultiValueFilter(meta: DataTableColumnMeta | undefined) {
  return meta?.options != null || MULTI_VALUE_FILTER_VARIANTS.has(meta?.variant ?? '');
}

function getColumnFiltersKey(filters: ColumnFiltersState) {
  // URL 往返后数字会变成字符串，key 需做同样的归一化才能对账
  return JSON.stringify(
    filters
      .map((filter) => ({
        id: filter.id,
        value: Array.isArray(filter.value)
          ? filter.value.map((value) => String(value))
          : String(filter.value)
      }))
      .toSorted((a, b) => a.id.localeCompare(b.id))
  );
}

interface UseDataTableProps<TData extends RowData>
  extends
    Omit<
      TableOptions<DataTableFeatures, TData>,
      'state' | 'pageCount' | 'features' | 'manualFiltering' | 'manualPagination' | 'manualSorting'
    >,
    Required<Pick<TableOptions<DataTableFeatures, TData>, 'pageCount'>> {
  initialState?: Omit<Partial<TableState<DataTableFeatures>>, 'sorting'> & {
    sorting?: ExtendedColumnSort<TData>[];
  };
  history?: 'push' | 'replace';
  debounceMs?: number;
  throttleMs?: number;
  clearOnDefault?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  startTransition?: React.TransitionStartFunction;
}

export function useDataTable<TData extends RowData>(props: UseDataTableProps<TData>) {
  const {
    columns,
    pageCount = -1,
    initialState,
    history = 'replace',
    debounceMs = DEBOUNCE_MS,
    throttleMs = THROTTLE_MS,
    clearOnDefault = false,
    scroll = false,
    shallow = true,
    startTransition,
    ...tableProps
  } = props;

  const queryStateOptions = React.useMemo<Omit<UseQueryStateOptions<string>, 'parse'>>(
    () => ({
      history,
      scroll,
      shallow,
      throttleMs,
      clearOnDefault,
      startTransition
    }),
    [history, scroll, shallow, throttleMs, clearOnDefault, startTransition]
  );

  const [initialTableState] = React.useState(initialState);

  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(
    initialTableState?.rowSelection ?? {}
  );
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>(
    initialTableState?.columnVisibility ?? {}
  );
  const [columnPinning, setColumnPinning] = React.useState<ColumnPinningState>(
    initialTableState?.columnPinning ?? { start: [], end: [] }
  );

  const pageParser = React.useMemo(
    () => parseAsInteger.withOptions(queryStateOptions).withDefault(1),
    [queryStateOptions]
  );
  const defaultPageSize = initialTableState?.pagination?.pageSize ?? 10;
  const perPageParser = React.useMemo(
    () => parseAsInteger.withOptions(queryStateOptions).withDefault(defaultPageSize),
    [defaultPageSize, queryStateOptions]
  );

  const [page, setPage] = useQueryState(PAGE_KEY, pageParser);
  const [perPage, setPerPage] = useQueryState(PER_PAGE_KEY, perPageParser);

  const pagination: PaginationState = React.useMemo(() => {
    return {
      pageIndex: page - 1, // zero-based index -> one-based index
      pageSize: perPage
    };
  }, [page, perPage]);

  const onPaginationChange = React.useCallback(
    (updaterOrValue: Updater<PaginationState>) => {
      const newPagination =
        typeof updaterOrValue === 'function' ? updaterOrValue(pagination) : updaterOrValue;

      // 服务端分页下行选择是页内语义，翻页后清空可避免选中新页的同索引行
      setRowSelection({});
      void setPage(newPagination.pageIndex + 1);
      void setPerPage(newPagination.pageSize);
    },
    [pagination, setPage, setPerPage]
  );

  const sortableColumnIds = React.useMemo(() => {
    return new Set(
      columns
        .filter(
          (column) =>
            ('accessorKey' in column || 'accessorFn' in column) && column.enableSorting !== false
        )
        .map((column) => column.id)
        .filter(Boolean) as string[]
    );
  }, [columns]);

  const sortingParser = React.useMemo(
    () =>
      getSortingStateParser<TData>(sortableColumnIds)
        .withOptions(queryStateOptions)
        .withDefault(initialTableState?.sorting ?? []),
    [sortableColumnIds, initialTableState, queryStateOptions]
  );

  const [sorting, setSorting] = useQueryState(SORT_KEY, sortingParser);

  const onSortingChange = React.useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      if (typeof updaterOrValue === 'function') {
        const newSorting = updaterOrValue(sorting);
        setSorting(newSorting as ExtendedColumnSort<TData>[]);
      } else {
        setSorting(updaterOrValue as ExtendedColumnSort<TData>[]);
      }
    },
    [sorting, setSorting]
  );

  const filterableColumns = React.useMemo(() => {
    return columns.filter((column) => column.enableColumnFilter);
  }, [columns]);

  const filterParsers = React.useMemo(() => {
    return filterableColumns.reduce<Record<string, Parser<string> | Parser<string[]>>>(
      (acc, column) => {
        acc[column.id ?? ''] = getIsMultiValueFilter(column.meta)
          ? parseAsArrayOf(parseAsString, ARRAY_SEPARATOR).withOptions(queryStateOptions)
          : parseAsString.withOptions(queryStateOptions);
        return acc;
      },
      {}
    );
  }, [filterableColumns, queryStateOptions]);

  const [filterValues, setFilterValues] = useQueryStates(filterParsers);

  const urlFilters = React.useMemo<ColumnFiltersState>(() => {
    return filterableColumns.flatMap((column) => {
      const id = column.id;
      if (!id) return [];

      const value = filterValues[id];
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        return [];
      }

      return [
        {
          id,
          value: getIsMultiValueFilter(column.meta) && !Array.isArray(value) ? [value] : value
        }
      ];
    });
  }, [filterableColumns, filterValues]);

  const urlFiltersKey = React.useMemo(() => getColumnFiltersKey(urlFilters), [urlFilters]);

  const [filtersDraft, setFiltersDraft] = React.useState<{
    filters: ColumnFiltersState;
    urlFiltersKey: string;
  } | null>(null);

  const columnFilters =
    filtersDraft?.urlFiltersKey === urlFiltersKey ? filtersDraft.filters : urlFilters;

  const debouncedSetFilterValues = useDebouncedCallback(
    (filters: ColumnFiltersState, sourceUrlFiltersKey: string) => {
      if (sourceUrlFiltersKey !== urlFiltersKey) return;

      const filterUpdates = filters.reduce<Record<string, string | string[] | null>>(
        (acc, filter) => {
          if (!filterableColumns.some((column) => column.id === filter.id)) return acc;
          acc[filter.id] = filter.value as string | string[];
          return acc;
        },
        {}
      );

      for (const column of filterableColumns) {
        if (column.id && !(column.id in filterUpdates)) {
          filterUpdates[column.id] = null;
        }
      }

      setFiltersDraft((prev) =>
        prev ? { ...prev, urlFiltersKey: getColumnFiltersKey(filters) } : prev
      );
      void setPage(1);
      void setFilterValues(filterUpdates);
    },
    debounceMs
  );

  const onColumnFiltersChange = React.useCallback(
    (updaterOrValue: Updater<ColumnFiltersState>) => {
      const newFilters =
        typeof updaterOrValue === 'function' ? updaterOrValue(columnFilters) : updaterOrValue;

      setFiltersDraft({ filters: newFilters, urlFiltersKey });
      debouncedSetFilterValues(newFilters, urlFiltersKey);
    },
    [columnFilters, debouncedSetFilterValues, urlFiltersKey]
  );

  const table = useTable({
    features: dataTableFeatures,
    ...tableProps,
    columns,
    initialState: initialTableState,
    pageCount,
    state: {
      pagination,
      sorting,
      columnVisibility,
      columnPinning,
      rowSelection,
      columnFilters
    },
    defaultColumn: {
      ...tableProps.defaultColumn,
      enableColumnFilter: false
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnPinningChange: setColumnPinning,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true
  });

  return { table, shallow, debounceMs, throttleMs };
}
