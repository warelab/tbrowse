import type { TableCellValue } from './types';

export interface AggregateContext {
  /** Non-null cell values across the leaves under the collapsed subtree, in
   *  tree-traversal order. */
  values: TableCellValue[];
  /** Total leaves in the collapsed subtree (excluding pruned subtrees), so
   *  totals match the chassis-supplied row `leafCount`. */
  totalLeaves: number;
  /** Convenience: leaves whose `values` entry was non-null. */
  leavesWithValue: number;
}

export interface AggregateResult {
  /** Compact text rendered in the cell. Empty string ⇒ render nothing. */
  text: string;
  /** Optional rich tooltip for the cell (defaults to `text`). */
  title?: string;
  /** Optional numeric "representative" value the cell can be colored by
   *  in heatmap display mode (e.g. mean for `mean ± stdev`). */
  numeric?: number;
}

export type AggregateFn = (ctx: AggregateContext) => AggregateResult | string;

export const NULL_GLYPH = '—';

export type ColumnKind = 'string' | 'number' | 'boolean';

export interface AggregateMethod {
  id: string;
  label: string;
  fn: AggregateFn;
}

function fmtNum(n: number, digits = 2): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function asNumbers(values: TableCellValue[]): number[] {
  return values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
}

const meanStdev: AggregateFn = ({ values, totalLeaves, leavesWithValue }) => {
  const nums = asNumbers(values);
  if (nums.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let mean = 0;
  for (const v of nums) mean += v;
  mean /= nums.length;
  if (nums.length === 1) {
    return {
      text: fmtNum(mean),
      title: `n=1 / ${totalLeaves}\nvalue=${fmtNum(mean, 6)}`,
      numeric: mean,
    };
  }
  let min = nums[0];
  let max = nums[0];
  let sumSq = 0;
  for (const v of nums) {
    if (v < min) min = v;
    if (v > max) max = v;
    const d = v - mean;
    sumSq += d * d;
  }
  const stdev = Math.sqrt(sumSq / (nums.length - 1));
  const text = `${fmtNum(mean)} ± ${fmtNum(stdev)}`;
  const title = [
    `n=${leavesWithValue} / ${totalLeaves}`,
    `mean=${fmtNum(mean, 6)}`,
    `stdev=${fmtNum(stdev, 6)}`,
    `min=${fmtNum(min, 6)}`,
    `max=${fmtNum(max, 6)}`,
  ].join('\n');
  return { text, title, numeric: mean };
};

const meanOnly: AggregateFn = ({ values, totalLeaves }) => {
  const nums = asNumbers(values);
  if (nums.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let mean = 0;
  for (const v of nums) mean += v;
  mean /= nums.length;
  return { text: fmtNum(mean), title: `mean of ${nums.length} / ${totalLeaves}`, numeric: mean };
};

const median: AggregateFn = ({ values, totalLeaves }) => {
  const nums = asNumbers(values).slice().sort((a, b) => a - b);
  if (nums.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  const mid = Math.floor(nums.length / 2);
  const m = nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
  return { text: fmtNum(m), title: `median of ${nums.length} / ${totalLeaves}`, numeric: m };
};

const minMax: AggregateFn = ({ values, totalLeaves }) => {
  const nums = asNumbers(values);
  if (nums.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let mn = nums[0];
  let mx = nums[0];
  for (const v of nums) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const text = mn === mx ? fmtNum(mn) : `${fmtNum(mn)} – ${fmtNum(mx)}`;
  return {
    text,
    title: `min=${fmtNum(mn, 6)}\nmax=${fmtNum(mx, 6)}\nn=${nums.length} / ${totalLeaves}`,
    numeric: (mn + mx) / 2,
  };
};

const sum: AggregateFn = ({ values, totalLeaves }) => {
  const nums = asNumbers(values);
  if (nums.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let s = 0;
  for (const v of nums) s += v;
  return { text: fmtNum(s), title: `sum of ${nums.length} / ${totalLeaves}`, numeric: s };
};

const fraction: AggregateFn = ({ values, totalLeaves, leavesWithValue }) => {
  if (leavesWithValue === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let trues = 0;
  for (const v of values) if (v === true) trues++;
  return {
    text: `${trues}/${leavesWithValue}`,
    title: `${trues} true · ${leavesWithValue - trues} false · ${totalLeaves - leavesWithValue} missing`,
    numeric: leavesWithValue === 0 ? 0 : trues / leavesWithValue,
  };
};

const percent: AggregateFn = ({ values, totalLeaves, leavesWithValue }) => {
  if (leavesWithValue === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  let trues = 0;
  for (const v of values) if (v === true) trues++;
  const pct = (trues / leavesWithValue) * 100;
  return {
    text: `${fmtNum(pct, 1)}%`,
    title: `${trues}/${leavesWithValue} true (of ${totalLeaves} total)`,
    numeric: trues / leavesWithValue,
  };
};

const countTrue: AggregateFn = ({ values, totalLeaves }) => {
  let trues = 0;
  for (const v of values) if (v === true) trues++;
  return {
    text: trues === 0 ? NULL_GLYPH : `${trues}`,
    title: `${trues} true / ${totalLeaves} leaves`,
    numeric: trues,
  };
};

const dominant: AggregateFn = ({ values, totalLeaves, leavesWithValue }) => {
  if (values.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  const counts = new Map<string, number>();
  for (const v of values) {
    const s = String(v);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 1) {
    return {
      text: sorted[0][0],
      title: `${leavesWithValue}/${totalLeaves} all "${sorted[0][0]}"`,
    };
  }
  const text =
    sorted.length <= 3
      ? sorted.map(([s]) => s).join(', ')
      : `${sorted.length} unique`;
  const title = sorted
    .slice(0, 8)
    .map(([s, c]) => `${s}: ${c}`)
    .concat(sorted.length > 8 ? [`… +${sorted.length - 8} more`] : [])
    .join('\n');
  return { text, title };
};

const uniqueCount: AggregateFn = ({ values, totalLeaves }) => {
  if (values.length === 0) return { text: NULL_GLYPH, title: `n=0 / ${totalLeaves}` };
  const set = new Set(values.map((v) => String(v)));
  return {
    text: `${set.size}`,
    title: `${set.size} unique values across ${values.length} / ${totalLeaves}`,
    numeric: set.size,
  };
};

export const AGGREGATE_METHODS: Record<ColumnKind, AggregateMethod[]> = {
  number: [
    { id: 'mean-stdev', label: 'Mean ± stdev', fn: meanStdev },
    { id: 'mean', label: 'Mean', fn: meanOnly },
    { id: 'median', label: 'Median', fn: median },
    { id: 'min-max', label: 'Min – Max', fn: minMax },
    { id: 'sum', label: 'Sum', fn: sum },
  ],
  boolean: [
    { id: 'fraction', label: 'n / total', fn: fraction },
    { id: 'percent', label: 'Percent true', fn: percent },
    { id: 'count-true', label: 'Count true', fn: countTrue },
  ],
  string: [
    { id: 'dominant', label: 'Dominant value', fn: dominant },
    { id: 'unique-count', label: 'Unique count', fn: uniqueCount },
  ],
};

export const DEFAULT_METHOD_ID: Record<ColumnKind, string> = {
  number: 'mean-stdev',
  boolean: 'fraction',
  string: 'dominant',
};

export function methodForKind(kind: ColumnKind, id: string | undefined): AggregateMethod {
  const list = AGGREGATE_METHODS[kind];
  if (id) {
    const m = list.find((m) => m.id === id);
    if (m) return m;
  }
  const def = list.find((m) => m.id === DEFAULT_METHOD_ID[kind]);
  return def ?? list[0];
}

/** Back-compat: a per-kind aggregator dictionary using each kind's default
 *  method. Hosts that imported `defaultAggregators` previously can keep
 *  using this without changes. */
export const defaultAggregators: Record<ColumnKind, AggregateFn> = {
  number: methodForKind('number', undefined).fn,
  boolean: methodForKind('boolean', undefined).fn,
  string: methodForKind('string', undefined).fn,
};

export function normalizeAggregateResult(
  out: AggregateResult | string,
): AggregateResult {
  return typeof out === 'string' ? { text: out } : out;
}
