import { buildChildrenIndex } from './treeIndex';
import type { NodeId, Tree } from './types';

export interface PivotState {
  collapsedNodeIds: NodeId[];
  swappedNodeIds: NodeId[];
  /** The resolved id of the target node (leaf gene id match takes precedence). */
  targetId: NodeId;
}

/**
 * Compute initial collapsed + swapped sets that pivot the tree to display
 * `identifier` at the top with everything else collapsed.
 *
 * Resolution order:
 *   1. A leaf whose `geneId` matches `identifier`.
 *   2. A node whose `id` matches `identifier`.
 *   3. Otherwise null (with a console warning).
 *
 * The pivot:
 * - Every internal node that is NOT on the root-to-target path is added
 *   to `collapsedNodeIds` (turning the deepest possible visible
 *   ancestors into triangles). Uncollapsing any of those triangles
 *   reveals the next level — also triangles — so the user can drill
 *   down level by level. Leaves are never collapsed (they're already
 *   minimal). The target's own descendants are also collapsed for the
 *   same drill-down reason.
 * - For each ancestor whose path-child is not its first child,
 *   `swappedNodeIds` includes the ancestor so its children render in
 *   reversed order, putting the path-child on top. (Assumes binary
 *   ancestors; for non-binary trees this is a best-effort pivot.)
 */
export function computePivotState(tree: Tree, identifier: string): PivotState | null {
  let target: NodeId | null = null;
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id];
    if (n.isLeaf && n.geneId === identifier) {
      target = id;
      break;
    }
  }
  if (target === null && tree.nodes[identifier] !== undefined) {
    target = identifier;
  }
  if (target === null) {
    // eslint-disable-next-line no-console
    console.warn(
      `tbrowse: nodeOfInterest "${identifier}" not found (no leaf with this geneId, no node with this id)`,
    );
    return null;
  }

  // Walk to root, collecting the path.
  const path: NodeId[] = [];
  let cur: NodeId | null = target;
  while (cur !== null) {
    path.push(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  path.reverse(); // root → target
  const pathSet = new Set(path);

  const collapsedNodeIds: NodeId[] = [];
  for (const id of Object.keys(tree.nodes)) {
    if (pathSet.has(id)) continue;
    const node = tree.nodes[id];
    if (!node || node.isLeaf) continue;
    collapsedNodeIds.push(id);
  }

  const childrenIndex = buildChildrenIndex(tree);
  const swappedNodeIds: NodeId[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const ancestorId = path[i];
    const pathChildId = path[i + 1];
    const children = childrenIndex.get(ancestorId) ?? [];
    if (children.indexOf(pathChildId) > 0) {
      swappedNodeIds.push(ancestorId);
    }
  }

  return { collapsedNodeIds, swappedNodeIds, targetId: target };
}
