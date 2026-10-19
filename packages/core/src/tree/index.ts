import type { GeneId, NodeId, Tree, TreeNode } from '../types';

/** Children index for a tree, keyed by parent id. Child order = insertion order of `tree.nodes`. */
export type ChildrenIndex = ReadonlyMap<NodeId, readonly NodeId[]>;

export function buildChildrenIndex(tree: Tree): ChildrenIndex {
  const map = new Map<NodeId, NodeId[]>();
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id];
    if (!n || n.parentId === null) continue;
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

/**
 * Leaf ids under `rootId` (default: the tree root) in child-insertion
 * order — the same order the viewer walks when nothing is swapped.
 */
export function leafIdsOf(
  tree: Tree,
  opts: { rootId?: NodeId; childrenIndex?: ChildrenIndex } = {},
): NodeId[] {
  const childrenIndex = opts.childrenIndex ?? buildChildrenIndex(tree);
  const out: NodeId[] = [];
  const visit = (id: NodeId): void => {
    const n = tree.nodes[id];
    if (!n) return;
    if (n.isLeaf) {
      out.push(id);
      return;
    }
    const kids = childrenIndex.get(id);
    if (kids) for (const k of kids) visit(k);
  };
  visit(opts.rootId ?? tree.rootId);
  return out;
}

/** `geneId` of every leaf that carries one, in tree order. */
export function leafGeneIds(tree: Tree): GeneId[] {
  const out: GeneId[] = [];
  for (const id of leafIdsOf(tree)) {
    const g = tree.nodes[id]?.geneId;
    if (g) out.push(g);
  }
  return out;
}

/** Ids from `nodeId` (first) up to the root (last). Empty when `nodeId` is unknown. */
export function pathToRoot(tree: Tree, nodeId: NodeId): NodeId[] {
  const path: NodeId[] = [];
  const seen = new Set<NodeId>();
  let cur: NodeId | null = tree.nodes[nodeId] ? nodeId : null;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    path.push(cur);
    cur = tree.nodes[cur]?.parentId ?? null;
  }
  return path;
}

/** Lowest common ancestor of `ids` (a node is its own ancestor). Null when `ids` is empty or any id is unknown. */
export function lca(tree: Tree, ids: Iterable<NodeId>): NodeId | null {
  let common: NodeId[] | null = null;
  for (const id of ids) {
    const path = pathToRoot(tree, id);
    if (path.length === 0) return null;
    if (common === null) {
      common = path;
      continue;
    }
    const inPath = new Set(path);
    const idx = common.findIndex((x) => inPath.has(x));
    if (idx < 0) return null;
    common = common.slice(idx);
  }
  return common ? (common[0] ?? null) : null;
}

/** Cumulative branch length from the root to `nodeId` (0 for the root; NaN for an unknown id). */
export function depthOf(tree: Tree, nodeId: NodeId): number {
  if (!tree.nodes[nodeId]) return NaN;
  let d = 0;
  for (const id of pathToRoot(tree, nodeId)) {
    const n = tree.nodes[id]!;
    if (n.parentId !== null) d += n.distance;
  }
  return d;
}

/**
 * Node heights for an (approximately) ultrametric tree: `height = maxRootDistance − rootDistance`,
 * so leaves of a UPGMA tree sit at 0 and the root at `maxHeight`. This is what the BrAPI
 * `tree.maxBranchHeight` field and gramene-g2p's `treeMaxHeight` report.
 */
export function nodeHeights(
  tree: Tree,
  childrenIndex: ChildrenIndex = buildChildrenIndex(tree),
): { heights: Record<NodeId, number>; maxHeight: number } {
  const rootDist: Record<NodeId, number> = {};
  let max = 0;
  const stack: Array<[NodeId, number]> = [[tree.rootId, 0]];
  while (stack.length > 0) {
    const [id, d] = stack.pop()!;
    const n = tree.nodes[id];
    if (!n) continue;
    rootDist[id] = d;
    if (d > max) max = d;
    const kids = childrenIndex.get(id);
    if (kids) for (const k of kids) stack.push([k, d + (tree.nodes[k]?.distance ?? 0)]);
  }
  const heights: Record<NodeId, number> = {};
  for (const id of Object.keys(rootDist)) heights[id] = max - rootDist[id]!;
  return { heights, maxHeight: max };
}

/**
 * Structural problems with a tree, as human-readable strings; `[]` when
 * the tree is sound. Checks: the root exists and has no parent, every
 * `parentId` names a node, at least one leaf, no cycles, every node is
 * reachable from the root, and `isLeaf` agrees with having no children.
 */
export function validateTree(tree: Tree): string[] {
  const problems: string[] = [];
  const root = tree.nodes[tree.rootId];
  if (!root) {
    problems.push(`root "${tree.rootId}" is not in nodes`);
    return problems;
  }
  if (root.parentId !== null) problems.push(`root "${tree.rootId}" has a parent`);
  const childrenIndex = buildChildrenIndex(tree);
  let leaves = 0;
  for (const id of Object.keys(tree.nodes)) {
    const n = tree.nodes[id]!;
    if (n.id !== id) problems.push(`node keyed "${id}" has id "${n.id}"`);
    if (n.parentId !== null && !tree.nodes[n.parentId]) {
      problems.push(`node "${id}" has unknown parent "${n.parentId}"`);
    }
    const kids = childrenIndex.get(id);
    if (n.isLeaf) {
      leaves++;
      if (kids && kids.length > 0) problems.push(`leaf "${id}" has ${kids.length} children`);
    } else if (!kids || kids.length === 0) {
      problems.push(`internal node "${id}" has no children`);
    }
  }
  if (leaves === 0) problems.push('tree has no leaves');
  const reachable = subtreeIdsOf(tree.rootId, childrenIndex);
  for (const id of Object.keys(tree.nodes)) {
    if (!reachable.has(id)) problems.push(`node "${id}" is not reachable from the root`);
  }
  for (const id of Object.keys(tree.nodes)) {
    const seen = new Set<NodeId>();
    let cur: NodeId | null = id;
    while (cur !== null) {
      if (seen.has(cur)) {
        problems.push(`cycle through "${cur}"`);
        break;
      }
      seen.add(cur);
      cur = tree.nodes[cur]?.parentId ?? null;
    }
  }
  return problems;
}

/** Throws `Error(validateTree(tree).join('; '))` when the tree is unsound. */
export function assertValidTree(tree: Tree): void {
  const problems = validateTree(tree);
  if (problems.length > 0) throw new Error(`Invalid tree: ${problems.join('; ')}`);
}

/** Type guard for the leaf nodes of a tree. */
export function isLeafNode(node: TreeNode | undefined): node is TreeNode & { isLeaf: true } {
  return !!node && node.isLeaf;
}

export * from './walk';
export * from './rollup';
export * from './prune';
export * from './pivot';
export * from './newick';
export * from './hierarchy';
export * from './swaps';
