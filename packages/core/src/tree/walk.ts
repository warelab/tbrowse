import type { NodeId, Tree } from '../types';
import { buildChildrenIndex, type ChildrenIndex } from './index';

/**
 * Options shared by the traversal helpers. `rootId` restricts the walk to a
 * subtree (default: the tree root); `swappedNodeIds` is the viewer's
 * `ViewState.swappedNodeIds` as a set — an internal node listed there has
 * its children visited in reversed order, so the walk yields display order;
 * `childrenIndex` lets callers reuse a precomputed `buildChildrenIndex`.
 */
export interface WalkOptions {
  rootId?: NodeId;
  swappedNodeIds?: ReadonlySet<NodeId>;
  childrenIndex?: ChildrenIndex;
}

const NO_CHILDREN: readonly NodeId[] = [];

/** Children of `id` in display order (reversed when `id` is swapped). */
function orderedChildren(
  id: NodeId,
  childrenIndex: ChildrenIndex,
  swapped: ReadonlySet<NodeId> | undefined,
): readonly NodeId[] {
  const kids = childrenIndex.get(id) ?? NO_CHILDREN;
  return swapped !== undefined && swapped.has(id) ? [...kids].reverse() : kids;
}

/**
 * Node ids in pre-order (a node before its children), honouring swaps. The
 * walk is iterative so deep (caterpillar) trees cannot overflow the stack;
 * ids that are missing from `tree.nodes` are skipped, and the children of a
 * node flagged `isLeaf` are never visited.
 */
export function preorder(tree: Tree, opts: WalkOptions = {}): NodeId[] {
  const childrenIndex = opts.childrenIndex ?? buildChildrenIndex(tree);
  const out: NodeId[] = [];
  const stack: NodeId[] = [opts.rootId ?? tree.rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const n = tree.nodes[id];
    if (!n) continue;
    out.push(id);
    if (n.isLeaf) continue;
    const kids = orderedChildren(id, childrenIndex, opts.swappedNodeIds);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}

/**
 * Node ids in post-order (children before their parent), honouring swaps.
 * Same skipping rules as `preorder`; iterative.
 */
export function postorder(tree: Tree, opts: WalkOptions = {}): NodeId[] {
  const childrenIndex = opts.childrenIndex ?? buildChildrenIndex(tree);
  const out: NodeId[] = [];
  const stack: Array<{ id: NodeId; expanded: boolean }> = [
    { id: opts.rootId ?? tree.rootId, expanded: false },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const n = tree.nodes[top.id];
    if (!n) {
      stack.pop();
      continue;
    }
    if (n.isLeaf || top.expanded) {
      out.push(top.id);
      stack.pop();
      continue;
    }
    top.expanded = true;
    const kids = orderedChildren(top.id, childrenIndex, opts.swappedNodeIds);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i]!, expanded: false });
  }
  return out;
}

/**
 * Leaf ids in display order — the order the viewer draws rows in once
 * `swappedNodeIds` is applied. This is what gramene-g2p's `leafOrder()` and
 * the BrAPI `tree.leafOrder` field correspond to; without swaps it equals
 * `leafIdsOf(tree)`.
 */
export function leafOrder(tree: Tree, opts: WalkOptions = {}): NodeId[] {
  const childrenIndex = opts.childrenIndex ?? buildChildrenIndex(tree);
  const out: NodeId[] = [];
  const stack: NodeId[] = [opts.rootId ?? tree.rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.isLeaf) {
      out.push(id);
      continue;
    }
    const kids = orderedChildren(id, childrenIndex, opts.swappedNodeIds);
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}
