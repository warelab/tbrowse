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

  // First row whose bottom edge is strictly inside the viewport (excluding
  // the case where the bottom touches scrollTop, which is zero-pixel
  // intersection).
  let firstVisible = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.y + r.height > scrollTop) {
      firstVisible = i;
      break;
    }
  }

  // Last row whose top edge is strictly inside the viewport. A row whose
  // top touches the viewport's bottom edge is zero-pixel and excluded.
  let lastVisible = firstVisible - 1;
  const viewportBottom = scrollTop + viewportHeight;
  for (let i = firstVisible; i < rows.length; i++) {
    if (rows[i].y >= viewportBottom) break;
    lastVisible = i;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(rows.length, lastVisible + 1 + overscan);
  return { startIndex, endIndex };
}
