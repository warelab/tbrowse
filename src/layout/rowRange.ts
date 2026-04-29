import type { RowRange, VisibleRow } from '../types';

const DEFAULT_OVERSCAN = 5;

export function computeRowRange(
  rows: VisibleRow[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number = DEFAULT_OVERSCAN,
): RowRange {
  if (rows.length === 0 || viewportHeight === 0) {
    return { startIndex: 0, endIndex: rows.length };
  }

  let firstVisible = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.y + r.height >= scrollTop) {
      firstVisible = i;
      break;
    }
  }

  let lastVisible = firstVisible;
  for (let i = firstVisible; i < rows.length; i++) {
    if (rows[i].y > scrollTop + viewportHeight) break;
    lastVisible = i;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(rows.length, lastVisible + 1 + overscan);
  return { startIndex, endIndex };
}
