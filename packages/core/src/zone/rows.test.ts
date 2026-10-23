import { describe, expect, it } from 'vitest';
import { rowFlags, rowsInRange, rowsTotalHeight } from './rows';
import type { VisibleRow } from '../types';

const rows: VisibleRow[] = [
  { kind: 'leaf', nodeId: 'a', y: 0, height: 24, leafCount: 1 },
  { kind: 'collapsedSummary', nodeId: 'c', y: 24, height: 24, leafCount: 7 },
  { kind: 'leaf', nodeId: 'b', y: 48, height: 30, leafCount: 1 },
];

describe('rowFlags', () => {
  it('reports selection, exact hover and subtree membership', () => {
    const s = { hoveredNodeId: 'c', hoveredSubtreeIds: new Set(['c', 'b']), selectedNodeId: 'a' };
    expect(rowFlags(rows[0]!, s)).toEqual({ isSelected: true, isExactHover: false, isInHoveredSubtree: false });
    expect(rowFlags(rows[1]!, s)).toEqual({ isSelected: false, isExactHover: true, isInHoveredSubtree: true });
    expect(rowFlags(rows[2]!, s)).toEqual({ isSelected: false, isExactHover: false, isInHoveredSubtree: true });
  });

  it('is all-false with nothing hovered or selected', () => {
    const s = { hoveredNodeId: null, hoveredSubtreeIds: new Set<string>(), selectedNodeId: null };
    for (const r of rows) expect(rowFlags(r, s)).toEqual({ isSelected: false, isExactHover: false, isInHoveredSubtree: false });
  });
});

describe('rowsTotalHeight', () => {
  it('is last.y + last.height, 0 when empty', () => {
    expect(rowsTotalHeight(rows)).toBe(78);
    expect(rowsTotalHeight([])).toBe(0);
    expect(rowsTotalHeight(rows.slice(0, 1))).toBe(24);
  });
});

describe('rowsInRange', () => {
  it('slices [startIndex, endIndex)', () => {
    expect(rowsInRange(rows, { startIndex: 1, endIndex: 3 })).toEqual(rows.slice(1, 3));
    expect(rowsInRange(rows, { startIndex: 0, endIndex: 0 })).toEqual([]);
    expect(rowsInRange(rows, { startIndex: 2, endIndex: 99 })).toEqual([rows[2]]);
  });
});
