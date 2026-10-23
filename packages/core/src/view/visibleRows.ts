/**
 * Row layout for the viewer: which tree nodes become rows (leaves and
 * collapsed-subtree summaries), their vertical positions, and the window of
 * rows a scroll viewport needs to render.
 *
 * Moved verbatim from `tbrowse/src/visibleRows.ts` (computeVisibleRows) and
 * `tbrowse/src/layout/rowRange.ts` (computeRowRange); only the import paths
 * and two non-null assertions required by `noUncheckedIndexedAccess` differ.
 */
import type { NodeId, RowRange, Tree, VisibleRow } from '../types';

/** Default height in px of a leaf row (origin `tbrowse/src/visibleRows.ts:3`). */
export const LEAF_ROW_HEIGHT = 24;
/** Default height in px of a collapsed-summary row (origin `tbrowse/src/visibleRows.ts:4`). */
export const SUMMARY_ROW_HEIGHT = 24;

/** Input to {@link computeVisibleRows} (origin `tbrowse/src/visibleRows.ts:6-15`). */
export interface VisibleRowsInput {
  tree: Tree;
  collapsedNodeIds: ReadonlySet<NodeId>;
  prunedNodeIds: ReadonlySet<NodeId>;
  /** Internal nodes whose children should be walked in reversed order. */
  swappedNodeIds?: ReadonlySet<NodeId>;
  /** Per-row height in px (leaf + collapsed-summary). Defaults to 24. */
  rowHeight?: number;
}

/**
 * Walk the tree depth-first and emit one row per visible leaf plus one
 * `collapsedSummary` row per collapsed internal node, assigning each row a
 * `y` offset so that rows pack tightly from 0. Pruned subtrees are skipped
 * entirely (and a collapsed node whose every leaf is pruned emits nothing);
 * swapped nodes have their children walked in reverse.
 *
 * Origin: `tbrowse/src/visibleRows.ts:17-76`.
 */
export function computeVisibleRows(input: VisibleRowsInput): VisibleRow[] {
  const { tree, collapsedNodeIds, prunedNodeIds, swappedNodeIds } = input;
  const leafHeight = input.rowHeight ?? LEAF_ROW_HEIGHT;
  const summaryHeight = input.rowHeight ?? SUMMARY_ROW_HEIGHT;

  const childrenOf: Record<NodeId, NodeId[]> = {};
  for (const node of Object.values(tree.nodes)) {
    if (node.parentId !== null) {
      (childrenOf[node.parentId] ??= []).push(node.id);
    }
  }

  const rows: VisibleRow[] = [];
  let y = 0;

  const walk = (nodeId: NodeId): void => {
    if (prunedNodeIds.has(nodeId)) return;
    const node = tree.nodes[nodeId];
    if (!node) return;

    if (collapsedNodeIds.has(nodeId) && !node.isLeaf) {
      const leafCount = countLeaves(nodeId, tree, prunedNodeIds, childrenOf);
      if (leafCount === 0) return;
      rows.push({
        kind: 'collapsedSummary',
        nodeId,
        y,
        height: summaryHeight,
        leafCount,
      });
      y += summaryHeight;
      return;
    }

    if (node.isLeaf) {
      rows.push({
        kind: 'leaf',
        nodeId,
        y,
        height: leafHeight,
        leafCount: 1,
      });
      y += leafHeight;
      return;
    }

    const kids = childrenOf[nodeId] ?? [];
    if (swappedNodeIds?.has(nodeId)) {
      for (let i = kids.length - 1; i >= 0; i--) walk(kids[i]!);
    } else {
      for (const childId of kids) walk(childId);
    }
  };

  walk(tree.rootId);
  return rows;
}

function countLeaves(
  nodeId: NodeId,
  tree: Tree,
  prunedNodeIds: ReadonlySet<NodeId>,
  childrenOf: Record<NodeId, NodeId[]>,
): number {
  if (prunedNodeIds.has(nodeId)) return 0;
  const node = tree.nodes[nodeId];
  if (!node) return 0;
  if (node.isLeaf) return 1;
  let total = 0;
  for (const childId of childrenOf[nodeId] ?? []) {
    total += countLeaves(childId, tree, prunedNodeIds, childrenOf);
  }
  return total;
}

const DEFAULT_OVERSCAN = 5;

/**
 * Given the rows from {@link computeVisibleRows}, return the half-open index
 * range `[startIndex, endIndex)` of rows that intersect a scroll viewport,
 * padded by `overscan` rows on each side. Rows that merely touch the
 * viewport edge (zero-pixel intersection) are excluded. An empty row list or
 * a zero-height viewport yields the full range.
 *
 * Origin: `tbrowse/src/layout/rowRange.ts:5-38`.
 */
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
    const r = rows[i]!;
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
    if (rows[i]!.y >= viewportBottom) break;
    lastVisible = i;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(rows.length, lastVisible + 1 + overscan);
  return { startIndex, endIndex };
}
