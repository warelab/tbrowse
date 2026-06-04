import type { Tree, NodeId, VisibleRow } from './types';

export const LEAF_ROW_HEIGHT = 24;
export const SUMMARY_ROW_HEIGHT = 24;

export interface VisibleRowsInput {
  tree: Tree;
  collapsedNodeIds: ReadonlySet<NodeId>;
  prunedNodeIds: ReadonlySet<NodeId>;
  /** Internal nodes whose children should be walked in reversed order. */
  swappedNodeIds?: ReadonlySet<NodeId>;
  /** Per-row height in px (leaf + collapsed-summary). Defaults to 24. */
  rowHeight?: number;
}

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
      for (let i = kids.length - 1; i >= 0; i--) walk(kids[i]);
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
