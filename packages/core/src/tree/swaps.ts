import type { NodeId, Tree, TreeNode } from '../types';
import { buildChildrenIndex } from './index';

function defaultKey(leaf: TreeNode): string {
  return leaf.geneId ?? leaf.id;
}

/**
 * Compute the `ViewState.swappedNodeIds` that make `leafOrder(tree, …)`
 * reproduce a requested leaf `order` (labels compared via `key(leaf)`,
 * default `geneId ?? id`). Each internal node is flagged when the minimum
 * requested rank among its children's subtrees runs strictly downward in
 * child order, so reversing it sorts them; for binary trees any order the
 * topology can realise is reproduced exactly, for polytomies only
 * reversals are available. Leaves absent from `order` rank last and never
 * cause a swap; labels in `order` matching no leaf are listed in
 * `unmatched`. This is how a BrAPI `tree.leafOrder` or g2p's `leafOrder()`
 * is mapped back onto a viewer view state.
 */
export function swapsForLeafOrder(
  tree: Tree,
  order: readonly string[],
  key: (leaf: TreeNode) => string = defaultKey,
): { swappedNodeIds: NodeId[]; unmatched: string[] } {
  const rank = new Map<string, number>();
  order.forEach((label, i) => {
    if (!rank.has(label)) rank.set(label, i);
  });
  const matched = new Set<string>();
  const childrenIndex = buildChildrenIndex(tree);
  const swappedNodeIds: NodeId[] = [];

  // Post-order: minimum rank in each subtree (Infinity when none is in `order`).
  const minRank = new Map<NodeId, number>();
  const stack: Array<{ id: NodeId; expanded: boolean }> = [{ id: tree.rootId, expanded: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const node = tree.nodes[top.id];
    if (!node) {
      stack.pop();
      continue;
    }
    if (node.isLeaf) {
      const k = key(node);
      const r = rank.get(k);
      if (r !== undefined) matched.add(k);
      minRank.set(top.id, r ?? Infinity);
      stack.pop();
      continue;
    }
    const kids = childrenIndex.get(top.id) ?? [];
    if (!top.expanded) {
      top.expanded = true;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, expanded: false });
      continue;
    }
    const ranks: number[] = [];
    for (const k of kids) {
      const r = minRank.get(k);
      if (r !== undefined) ranks.push(r);
    }
    let descending = ranks.length >= 2;
    for (let i = 1; i < ranks.length && descending; i++) {
      if (!(ranks[i]! < ranks[i - 1]!)) descending = false;
    }
    if (descending) swappedNodeIds.push(top.id);
    minRank.set(top.id, ranks.length > 0 ? Math.min(...ranks) : Infinity);
    stack.pop();
  }

  const unmatched: string[] = [];
  for (const label of rank.keys()) if (!matched.has(label)) unmatched.push(label);
  return { swappedNodeIds, unmatched };
}
