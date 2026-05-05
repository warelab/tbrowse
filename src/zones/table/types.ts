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
  /** Default for the user-toggleable "searchable" flag. Only honoured on
   *  string-kind columns. Defaults to false. */
  searchable?: boolean;
  /** Default heatmap palette id from the registry in `./heatmap`. When
   *  unset, the zone auto-picks: a diverging palette when the column's
   *  data domain crosses zero, sequential otherwise. Only honoured when
   *  `display === 'heatmap'`. */
  palette?: string;
  /** Anchor for the diverging palette's midpoint (in data units). When
   *  unset, defaults to 0. Ignored for sequential palettes. */
  paletteMidpoint?: number;
}

export interface TableColumnOverride {
  label?: string;
  hidden?: boolean;
  kind?: ColumnKind;
  display?: TableDisplayMode;
  /** Aggregate-method id from `AGGREGATE_METHODS[kind]`. Ignored when the
   *  factory column has a hard `aggregate` override. */
  aggregateMethod?: string;
  /** When true, the column contributes a SearchField to the search-bar
   *  dropdown (label `"<zoneName> | <columnName>"`). Honoured only on
   *  string-kind columns. */
  searchable?: boolean;
  /** User-chosen palette id. Falls back to the factory column's
   *  `palette`, then to the data-driven auto-pick. */
  palette?: string;
  /** User-chosen midpoint for diverging palettes. Falls back to the
   *  factory column's `paletteMidpoint`, then to 0. */
  paletteMidpoint?: number;
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
