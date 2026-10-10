import type {
  DataTableColumnMeta,
  ExtendedColumnFilter,
  FilterOperator,
  FilterVariant
} from '@/types/data-table';
import {
  type Column,
  type RowData,
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFacetedMinMaxValues,
  createFacetedRowModel,
  createFacetedUniqueValues,
  metaHelper,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures
} from '@tanstack/react-table';

import { dataTableConfig } from '@/config/data-table';

/**
 * 全部数据表共用的 Table V9 特性集（tree-shakeable）。
 * 只注册本项目实际用到的能力：排序 / 筛选 / 分页 / 行选择 / 列可见性 / 列固定 / 列尺寸 / 分面。
 * 排序、筛选、分页均为服务端（manual*），故按官方指引省略对应的客户端 row model 工厂；
 * 分面（faceting）仍在客户端基于当前数据计算，故保留其 row model 工厂。
 * `columnMeta` slot 取代了对 ColumnMeta 的全局声明合并。
 */
export const dataTableFeatures = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnOrderingFeature,
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  facetedMinMaxValues: createFacetedMinMaxValues(),
  columnMeta: metaHelper<DataTableColumnMeta>()
});

/** `dataTableFeatures` 的类型，用作各处 `Table` / `Column` / `ColumnDef` 的 `TFeatures` 参数。 */
export type DataTableFeatures = typeof dataTableFeatures;

export function getCommonPinningStyles<TData extends RowData>({
  column
}: {
  column: Column<DataTableFeatures, TData>;
}): React.CSSProperties {
  const isPinned = column.getIsPinned();
  const isLastStartPinnedColumn = isPinned === 'start' && column.getIsLastColumn('start');
  const isFirstEndPinnedColumn = isPinned === 'end' && column.getIsFirstColumn('end');

  return {
    boxShadow: isLastStartPinnedColumn
      ? '-5px 0 5px -5px var(--border) inset'
      : isFirstEndPinnedColumn
        ? '5px 0 5px -5px var(--border) inset'
        : undefined,
    left: isPinned === 'start' ? `${column.getStart('start')}px` : undefined,
    right: isPinned === 'end' ? `${column.getAfter('end')}px` : undefined,
    position: isPinned ? 'sticky' : 'relative',
    background: isPinned ? 'var(--background)' : undefined,
    width: column.getSize(),
    zIndex: isPinned ? 1 : 0
  };
}

export function getFilterOperators(filterVariant: FilterVariant) {
  const operatorMap: Record<FilterVariant, { label: string; value: FilterOperator }[]> = {
    text: dataTableConfig.textOperators,
    number: dataTableConfig.numericOperators,
    range: dataTableConfig.numericOperators,
    date: dataTableConfig.dateOperators,
    dateRange: dataTableConfig.dateOperators,
    boolean: dataTableConfig.booleanOperators,
    select: dataTableConfig.selectOperators,
    multiSelect: dataTableConfig.multiSelectOperators
  };

  return operatorMap[filterVariant] ?? dataTableConfig.textOperators;
}

export function getDefaultFilterOperator(filterVariant: FilterVariant) {
  const operators = getFilterOperators(filterVariant);

  return operators[0]?.value ?? (filterVariant === 'text' ? 'iLike' : 'eq');
}

export function getValidFilters<TData>(
  filters: ExtendedColumnFilter<TData>[]
): ExtendedColumnFilter<TData>[] {
  return filters.filter(
    (filter) =>
      filter.operator === 'isEmpty' ||
      filter.operator === 'isNotEmpty' ||
      (Array.isArray(filter.value)
        ? filter.value.length > 0
        : filter.value !== '' && filter.value !== null && filter.value !== undefined)
  );
}
