import type { GeneId } from '../../types';
import type {
  AggregateContext,
  AggregateFn,
  AggregateResult,
  ColumnKind,
} from './aggregators';

export type TableCellValue = string | number | boolean | null | undefined;

export type TableData = Record<GeneId, Record<string, TableCellValue>>;

export type TableDisplayMode = 'text' | 'heatmap';

export interface TableColumn {
  id: string;
  label: string;
  kind?: ColumnKind;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: TableCellValue) => string;
  /** Default display mode for this column. Falls back to 'text'. */
  display?: TableDisplayMode;
  /** Hard override aggregator. When set, this beats both the kind default
   *  and the user's chosen `aggregateMethod` in zoneState. */
  aggregate?: AggregateFn;
}

export interface TableColumnOverride {
  label?: string;
  hidden?: boolean;
  kind?: ColumnKind;
  display?: TableDisplayMode;
  /** Aggregate-method id from `AGGREGATE_METHODS[kind]`. Ignored when the
   *  factory column has a hard `aggregate` override. */
  aggregateMethod?: string;
}

export interface TableZoneState {
  /** User-provided override for the zone name. */
  name?: string;
  /** Per-column overrides. Missing keys ⇒ use factory defaults. */
  columnOverrides?: Record<string, TableColumnOverride>;
  /** User-chosen column order (ids). Ids missing from this array fall back
   *  to factory order at the end; ids in this array that don't exist on the
   *  factory are silently dropped. Empty/undefined ⇒ factory order. */
  columnOrder?: string[];
}

export interface CreateTableZoneOptions {
  id: string;
  defaultName: string;
  table: TableData;
  columns: TableColumn[];
  defaultWidth?: number;
  minWidth?: number;
  defaultVisible?: boolean;
}

export type {
  AggregateContext,
  AggregateFn,
  AggregateResult,
  ColumnKind,
};
