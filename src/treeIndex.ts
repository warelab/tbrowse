import type { NodeId, Tree } from './types';

/** Children index for a tree, keyed by parent id. */
export type ChildrenIndex = ReadonlyMap<NodeId, readonly NodeId[]>;

export function buildChildrenIndex(tree: Tree): ChildrenIndex {
  const map = new Map<NodeId, NodeId[]>();
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id];
    if (n.parentId === null) continue;
    let arr = map.get(n.parentId);
    if (!arr) {
      arr = [];
      map.set(n.parentId, arr);
    }
    arr.push(id);
  }
  return map;
}

/** All node ids in the subtree rooted at `rootId`, including `rootId` itself. */
export function subtreeIdsOf(rootId: NodeId, childrenIndex: ChildrenIndex): Set<NodeId> {
  const result = new Set<NodeId>([rootId]);
  const stack: NodeId[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const kids = childrenIndex.get(id);
    if (!kids) continue;
    for (const k of kids) {
      if (!result.has(k)) {
        result.add(k);
        stack.push(k);
      }
    }
  }
  return result;
}

/** Strict ancestors of `nodeId` (root included if it is an ancestor). */
export function ancestorIdsOf(tree: Tree, nodeId: NodeId): Set<NodeId> {
  const result = new Set<NodeId>();
  let cur = tree.nodes[nodeId]?.parentId ?? null;
  while (cur !== null) {
    if (result.has(cur)) break;
    result.add(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return result;
}

export const EMPTY_NODE_ID_SET: ReadonlySet<NodeId> = new Set();

/** Count of leaf nodes in the full subtree rooted at `rootId`. */
export function countLeavesInSubtree(
  rootId: NodeId,
  tree: Tree,
  childrenIndex: ChildrenIndex,
): number {
  let count = 0;
  const stack: NodeId[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const n = tree.nodes[id];
    if (!n) continue;
    if (n.isLeaf) {
      count++;
      continue;
    }
    const kids = childrenIndex.get(id);
    if (kids) for (const k of kids) stack.push(k);
  }
  return count;
}
