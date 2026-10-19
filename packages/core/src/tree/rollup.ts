import type { NodeId, Tree, TreeNode } from '../types';
import { buildChildrenIndex, leafIdsOf, type ChildrenIndex } from './index';

/**
 * Generic post-order aggregation: every leaf reachable from the root gets
 * `leafValue(leaf)`, every internal node gets `combine(childValues, node)`
 * where `childValues` are its children's results in child order. Nodes not
 * reachable from the root are absent from the result; a child id missing
 * from `tree.nodes` contributes nothing. Iterative, so deep trees are safe.
 *
 * `sumLeafCounts`, `countsFromFacet`, `sumByNode` and `maxByNode` are all
 * instances of this.
 */
export function rollUp<T>(
  tree: Tree,
  leafValue: (leaf: TreeNode) => T,
  combine: (childValues: T[], node: TreeNode) => T,
  opts: { childrenIndex?: ChildrenIndex } = {},
): Record<NodeId, T> {
  const childrenIndex = opts.childrenIndex ?? buildChildrenIndex(tree);
  const values = new Map<NodeId, T>();
  const stack: Array<{ id: NodeId; expanded: boolean }> = [{ id: tree.rootId, expanded: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const node = tree.nodes[top.id];
    if (!node) {
      stack.pop();
      continue;
    }
    if (node.isLeaf) {
      values.set(top.id, leafValue(node));
      stack.pop();
      continue;
    }
    const kids = childrenIndex.get(top.id) ?? [];
    if (!top.expanded) {
      top.expanded = true;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, expanded: false });
      continue;
    }
    const childValues: T[] = [];
    for (const k of kids) {
      if (values.has(k)) childValues.push(values.get(k)!);
    }
    values.set(top.id, combine(childValues, node));
    stack.pop();
  }
  const out: Record<NodeId, T> = {};
  for (const [id, v] of values) out[id] = v;
  return out;
}

/**
 * Sum per-leaf counts up the tree so every node (not just leaves) has a
 * total: a leaf's count is `leafCounts[id] || 0`, an internal node's is the
 * sum over its children — what a collapsed-summary row should display.
 * Origin: gramene-search `taxTree/countsZone.js:20-53` (`computeGeneCounts`,
 * minus the facet parsing, which lives in `zone/counts.ts`).
 */
export function sumLeafCounts(tree: Tree, leafCounts: Record<NodeId, number>): Record<NodeId, number> {
  return rollUp(
    tree,
    (leaf) => leafCounts[leaf.id] || 0,
    (childValues) => {
      let sum = 0;
      for (const v of childValues) sum += v;
      return sum;
    },
  );
}

/**
 * Ids of the highest nodes whose entire subtree contains no leaf that
 * `keepLeaf` accepts (maximal excluded clades), so a viewer sheds one stub
 * per clade instead of one per leaf. Lifted filter, kept verbatim: a node is
 * returned when it keeps nothing AND (it is the root OR its parent keeps
 * something). Consequently, when NO leaf is kept the result is `[rootId]` —
 * callers that must never prune the root (Homology keeps the gene of
 * interest) guarantee that through `keepLeaf`. Nodes whose parent id is not
 * in `tree.nodes` are treated as keeping nothing.
 * Origin: gramene-search `details/Homology.js:107-137` (`getGenomePrunedIds`).
 */
export function maximalExcludedClades(
  tree: Tree,
  keepLeaf: (leaf: TreeNode) => boolean,
  childrenIndex: ChildrenIndex = buildChildrenIndex(tree),
): NodeId[] {
  const nodes = tree.nodes;
  // hasKept(node): does the subtree contain a leaf we must keep? Memoised post-order walk.
  const memo = new Map<NodeId, boolean>();
  const hasKept = (id: NodeId): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const n = nodes[id];
    const v = !n ? false : n.isLeaf ? keepLeaf(n) : (childrenIndex.get(id) ?? []).some(hasKept);
    memo.set(id, v);
    return v;
  };
  // A node is a maximal excluded clade when it keeps nothing but its parent
  // does (or it's the root) — i.e. the highest fully-excluded node on its path.
  return Object.values(nodes)
    .filter((n) => !hasKept(n.id) && (n.parentId == null || hasKept(n.parentId)))
    .map((n) => n.id);
}

/**
 * Ids of the leaves (in `leafIdsOf` order) that `keepLeaf` rejects —
 * leaf-only pruning. Hiding just the leaves is enough for a viewer, since
 * internal nodes with no visible descendants contribute no rows. The
 * original filtered the adapter's pre-order `leafTaxonIds`; the id set is
 * identical, and only the order can differ (integer-like ids enumerate
 * numerically), which `ViewState.prunedNodeIds` ignores.
 * Origin: gramene-search `TaxDistTbrowse.js:156-167`
 * (`adapter.leafTaxonIds.filter((id) => !selected[id])`).
 */
export function leavesFailing(tree: Tree, keepLeaf: (leaf: TreeNode) => boolean): NodeId[] {
  return leafIdsOf(tree).filter((id) => !keepLeaf(tree.nodes[id]!));
}
