import type { NodeId, Tree, TreeNode } from '../types';
import { buildChildrenIndex, subtreeIdsOf } from './index';

/** Options for `pruneToLeaves`. */
export interface PruneOptions {
  /**
   * Splice internal nodes left with a single surviving child, adding the
   * spliced node's `distance` onto the child's (default true). With false,
   * unary internal nodes are kept.
   */
  collapseUnary?: boolean;
}

/**
 * Prune a tree to the leaves in `keep` (a set of leaf ids or a predicate).
 * Internal nodes with no surviving descendant are dropped; with
 * `collapseUnary` (default) an internal node left with one surviving child
 * is spliced out and the child's branch length becomes the sum of the two,
 * so root-to-leaf distances are preserved. When the root itself is spliced
 * the surviving child becomes the new root (its `parentId` is nulled; its
 * summed `distance` is kept). Returns null when no leaf survives. Node
 * insertion order — and therefore child order — is preserved.
 * Origin: gramene-g2p `apps/ui/src/pages/Genotypes.tsx:530-538`
 * (`pruneToSamples`, binary `L ?? R` collapse), generalised to n-ary trees.
 */
export function pruneToLeaves(
  tree: Tree,
  keep: ReadonlySet<NodeId> | ((leaf: TreeNode) => boolean),
  opts: PruneOptions = {},
): Tree | null {
  const collapseUnary = opts.collapseUnary ?? true;
  const keepLeaf = typeof keep === 'function' ? keep : (leaf: TreeNode) => keep.has(leaf.id);
  const childrenIndex = buildChildrenIndex(tree);

  // Post-order: survivor id of each subtree (the node itself, or — when
  // spliced — the single surviving descendant that replaces it), plus the
  // extra distance accumulated by splicing.
  const survivor = new Map<NodeId, NodeId>();
  const extraDistance = new Map<NodeId, number>();
  const stack: Array<{ id: NodeId; expanded: boolean }> = [{ id: tree.rootId, expanded: false }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const node = tree.nodes[top.id];
    if (!node) {
      stack.pop();
      continue;
    }
    if (node.isLeaf) {
      if (keepLeaf(node)) survivor.set(top.id, top.id);
      stack.pop();
      continue;
    }
    const kids = childrenIndex.get(top.id) ?? [];
    if (!top.expanded) {
      top.expanded = true;
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, expanded: false });
      continue;
    }
    const alive: NodeId[] = [];
    for (const k of kids) {
      const s = survivor.get(k);
      if (s !== undefined) alive.push(s);
    }
    if (alive.length === 0) {
      // dropped
    } else if (alive.length === 1 && collapseUnary) {
      const child = alive[0]!;
      survivor.set(top.id, child);
      extraDistance.set(child, (extraDistance.get(child) ?? 0) + node.distance);
    } else {
      survivor.set(top.id, top.id);
    }
    stack.pop();
  }

  const newRootId = survivor.get(tree.rootId);
  if (newRootId === undefined) return null;

  const nodes: Record<NodeId, TreeNode> = {};
  for (const id of Object.keys(tree.nodes)) {
    if (survivor.get(id) !== id) continue; // dropped or spliced away
    const node = tree.nodes[id]!;
    const parentId = id === newRootId ? null : survivorParent(node, tree, survivor);
    const extra = extraDistance.get(id) ?? 0;
    nodes[id] = { ...node, parentId, distance: node.distance + extra };
  }
  return { rootId: newRootId, nodes };
}

/** Nearest ancestor that survives as itself (not spliced away). */
function survivorParent(node: TreeNode, tree: Tree, survivor: ReadonlyMap<NodeId, NodeId>): NodeId | null {
  let p = node.parentId;
  while (p !== null) {
    if (survivor.get(p) === p) return p;
    p = tree.nodes[p]?.parentId ?? null;
  }
  return null;
}

/**
 * The subtree rooted at `rootId` as a standalone tree: the same node
 * objects (shallow-copied) in their original insertion order, with the new
 * root's `parentId` set to null and its `distance` kept. Throws when
 * `rootId` is not in the tree.
 */
export function subtree(tree: Tree, rootId: NodeId): Tree {
  const root = tree.nodes[rootId];
  if (!root) throw new Error(`subtree: node "${rootId}" is not in the tree`);
  const ids = subtreeIdsOf(rootId, buildChildrenIndex(tree));
  const nodes: Record<NodeId, TreeNode> = {};
  for (const id of Object.keys(tree.nodes)) {
    if (!ids.has(id)) continue;
    const node = tree.nodes[id]!;
    nodes[id] = id === rootId ? { ...node, parentId: null } : { ...node };
  }
  return { rootId, nodes };
}
