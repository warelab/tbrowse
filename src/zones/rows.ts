import {
  rowFlags,
  rowsInRange,
  type RowFlags,
  type RowRange,
  type VisibleRow,
} from 'tbrowse-core';

/**
 * Background for a zone row given its hover/selection flags, in terms of
 * the chassis theme variables. This is the one place the row-highlight
 * colour vocabulary lives; host-defined zones (gramene-search's counts,
 * bins and expression zones) previously each carried a private copy.
 */
export function rowHighlightBackground(f: RowFlags): string {
  if (f.isSelected) return 'var(--tbrowse-row-select-bg)';
  if (f.isExactHover) return 'var(--tbrowse-row-hover-bg)';
  if (f.isInHoveredSubtree) return 'var(--tbrowse-row-subtree-bg)';
  return 'transparent';
}

/**
 * The rows a zone body should paint for the current virtualised range,
 * each with its flags and resolved background — the common prologue of a
 * host-defined zone's `Body`.
 */
export function rowsWithFlags(
  rows: readonly VisibleRow[],
  range: RowRange,
  s: Parameters<typeof rowFlags>[1],
): Array<{ row: VisibleRow; flags: RowFlags; background: string }> {
  return rowsInRange(rows, range).map((row) => {
    const flags = rowFlags(row, s);
    return { row, flags, background: rowHighlightBackground(flags) };
  });
}
