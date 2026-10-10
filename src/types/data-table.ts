import type { DataTableConfig } from '@/config/data-table';
import type { FilterItemSchema } from '@/lib/parsers';
import type { ColumnSort, Row, RowData, TableFeatures } from '@tanstack/react-table';

/**
 * 所有数据表共用的列 meta 形状。
 * Table V9 通过 `dataTableFeatures` 上的 `columnMeta` slot（metaHelper）按表注入，
 * 不再依赖对 `@tanstack/react-table` 的全局声明合并。
 */
export interface DataTableColumnMeta {
  label?: string;
  placeholder?: string;
  variant?: FilterVariant;
  options?: Option[];
  range?: [number, number];
  unit?: string;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
}

export interface Option {
  label: string;
  value: string;
  count?: number;
  icon?: React.FC<React.SVGProps<SVGSVGElement>>;
}

export type FilterOperator = DataTableConfig['operators'][number];
export type FilterVariant = DataTableConfig['filterVariants'][number];
export type JoinOperator = DataTableConfig['joinOperators'][number];

export interface ExtendedColumnSort<TData> extends Omit<ColumnSort, 'id'> {
  id: Extract<keyof TData, string>;
}

export interface ExtendedColumnFilter<TData> extends FilterItemSchema {
  id: Extract<keyof TData, string>;
}

export interface DataTableRowAction<TFeatures extends TableFeatures, TData extends RowData> {
  row: Row<TFeatures, TData>;
  variant: 'update' | 'delete';
}
