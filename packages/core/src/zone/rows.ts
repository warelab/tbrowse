import type { NodeId, RowRange, VisibleRow } from '../types';

/**
 * Per-row highlight flags, in the precedence order the viewer's zones
 * apply them: selected > exact hover > inside the hovered subtree. The
 * CSS-variable mapping (`rowHighlightBackground`) lives in tbrowse.
 */
export interface RowFlags {
  isSelected: boolean;
  isExactHover: boolean;
  isInHoveredSubtree: boolean;
}

/**
 * Flags for one visible row from the chassis's hover/selection state.
 * `hoveredSubtreeIds` normally contains the hovered node itself, so an
 * exactly-hovered row has both hover flags set.
 * Origin: gramene-search `taxTree/countsZone.js:84-88` (the `rowHighlight`
 * call arguments).
 */
export function rowFlags(
  row: VisibleRow,
  s: { hoveredNodeId: NodeId | null; hoveredSubtreeIds: ReadonlySet<NodeId>; selectedNodeId: NodeId | null },
): RowFlags {
  return {
    isSelected: s.selectedNodeId === row.nodeId,
    isExactHover: s.hoveredNodeId === row.nodeId,
    isInHoveredSubtree: !!(s.hoveredSubtreeIds && s.hoveredSubtreeIds.has(row.nodeId)),
  };
}

/**
 * Total pixel height of a row list: `last.y + last.height`, 0 when empty.
 * Zones size their scroll body to this.
 * Origin: gramene-search `taxTree/countsZone.js:74-76` (`totalHeight`).
 */
export function rowsTotalHeight(rows: readonly VisibleRow[]): number {
  const last = rows[rows.length - 1];
  return last ? last.y + last.height : 0;
}

/**
 * The rows inside the viewer's virtualised window:
 * `rows.slice(range.startIndex, range.endIndex)`.
 * Origin: gramene-search `taxTree/countsZone.js:78`.
 */
export function rowsInRange(rows: readonly VisibleRow[], range: RowRange): VisibleRow[] {
  return rows.slice(range.startIndex, range.endIndex);
}
