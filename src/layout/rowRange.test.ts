import { describe, expect, it } from 'vitest';
import { computeRowRange } from './rowRange';
import type { VisibleRow } from '../types';

const rows: VisibleRow[] = Array.from({ length: 100 }, (_, i) => ({
  kind: 'leaf',
  nodeId: `n${i}`,
  y: i * 24,
  height: 24,
  leafCount: 1,
}));

describe('computeRowRange', () => {
  it('returns the full range when viewport height is 0', () => {
    expect(computeRowRange(rows, 0, 0)).toEqual({ startIndex: 0, endIndex: 100 });
  });

  it('returns the full range for an empty rows array', () => {
    expect(computeRowRange([], 100, 600)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('windows around the visible range with overscan', () => {
    // viewport 600px = 25 rows fully visible; row 24's bottom touches the
    // viewport bottom (still considered visible). Default overscan = 5.
    const r = computeRowRange(rows, 0, 600);
    expect(r.startIndex).toBe(0); // can't overscan past 0
    expect(r.endIndex).toBe(30); // lastVisible 24 + 1 (exclusive) + overscan 5
  });

  it('shifts the window forward as scrollTop increases', () => {
    // Scroll 240px down → first visible row index 10.
    const r = computeRowRange(rows, 240, 600);
    // first visible = 10, last visible = 34, overscan ±5
    expect(r.startIndex).toBe(5);
    expect(r.endIndex).toBe(40);
  });

  it('clamps endIndex to the rows length', () => {
    const r = computeRowRange(rows, 9999, 600);
    expect(r.endIndex).toBe(100);
    expect(r.startIndex).toBeGreaterThanOrEqual(94);
  });

  it('honours an explicit overscan parameter', () => {
    const r0 = computeRowRange(rows, 240, 600, 0);
    expect(r0.startIndex).toBe(10);
    expect(r0.endIndex).toBe(35);
  });
});
