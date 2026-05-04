import type { NodeId, Tree, VisibleRow } from '../../types';

/** Floor applied to each branch's contribution to layout depth.
 *  Branches with a `distance` smaller than this — including zeros
 *  and tiny floating-point values like 1e-7 from upstream gene-tree
 *  exporters — are bumped up to `MIN_BRANCH_DISTANCE` so the child
 *  node's x doesn't collapse onto its parent's. The underlying
 *  `TreeNode.distance` data is not modified; the clamp only affects
 *  the cumulative depth used for x-positioning. */
const MIN_BRANCH_DISTANCE = 0.01;

export interface TreeLayoutNode {
  nodeId: NodeId;
  parentId: NodeId | null;
  x: number;
  y: number;
  /** True if this node corresponds to a row (leaf or collapsedSummary). */
  isVisibleEnd: boolean;
  isLeaf: boolean;
  isCollapsedSummary: boolean;
}

export interface TreeLayoutResult {
  nodes: TreeLayoutNode[];
  rootId: NodeId | null;
}

export interface TreeLayoutInput {
  tree: Tree;
  visibleRows: VisibleRow[];
  drawingLeftX: number;
  drawingWidth: number;
}

/**
 * Phylogram layout. Pure function of (tree, visibleRows, drawing area).
 *
 * - The set of "visible end" nodes (leaves + collapsed summaries) comes from
 *   visibleRows, and their y is the row center.
 * - Internal visible nodes are ancestors of those ends, up to the root.
 *   Their y is the midpoint of their children's y; their x is cumulative
 *   branch-length distance from root, normalised to fit drawingWidth so the
 *   deepest visible end sits at drawingLeftX + drawingWidth.
 */
export function computeTreeLayout(input: TreeLayoutInput): TreeLayoutResult {
  const { tree, visibleRows, drawingLeftX, drawingWidth } = input;

  if (visibleRows.length === 0) {
    return { nodes: [], rootId: null };
  }

  // Map row → row, and collect the visible-node closure (ends + ancestors).
  const endById = new Map<NodeId, VisibleRow>();
  for (const r of visibleRows) endById.set(r.nodeId, r);

  const visible = new Set<NodeId>();
  for (const r of visibleRows) {
    let cur: NodeId | null = r.nodeId;
    while (cur && !visible.has(cur)) {
      visible.add(cur);
      cur = tree.nodes[cur]?.parentId ?? null;
    }
  }

  if (!visible.has(tree.rootId)) {
    return { nodes: [], rootId: null };
  }

  // Children index restricted to visible nodes.
  const childrenOf = new Map<NodeId, NodeId[]>();
  for (const id of visible) {
    const n = tree.nodes[id];
    if (!n || n.parentId === null) continue;
    if (!visible.has(n.parentId)) continue;
    let arr = childrenOf.get(n.parentId);
    if (!arr) {
      arr = [];
      childrenOf.set(n.parentId, arr);
    }
    arr.push(id);
  }

  // Cumulative distance from root via BFS. Each branch contributes
  // at least `MIN_BRANCH_DISTANCE` to the layout, so very-short
  // branches (zero-length, or measured-but-tiny like 1e-7 from a
  // gene-tree exporter) still get a visible horizontal segment
  // instead of collapsing onto their parent's x. The underlying
  // `tree.nodes[child].distance` is left untouched — the floor
  // applies only to layout depth, not to the data.
  const depth = new Map<NodeId, number>();
  depth.set(tree.rootId, 0);
  const queue: NodeId[] = [tree.rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const child of childrenOf.get(id) ?? []) {
      const raw = tree.nodes[child]?.distance ?? 0;
      const clamped = Math.max(MIN_BRANCH_DISTANCE, raw);
      depth.set(child, d + clamped);
      queue.push(child);
    }
  }

  // Scale x so the deepest visible end sits at drawingLeftX + drawingWidth.
  let maxEndDepth = 0;
  for (const id of endById.keys()) {
    const d = depth.get(id) ?? 0;
    if (d > maxEndDepth) maxEndDepth = d;
  }
  const xScale = maxEndDepth > 0 ? drawingWidth / maxEndDepth : 0;

  const xById = new Map<NodeId, number>();
  for (const [id, d] of depth) xById.set(id, drawingLeftX + d * xScale);

  // y for ends = row centre; y for internals = midpoint of children y (postorder).
  const yById = new Map<NodeId, number>();
  for (const r of visibleRows) yById.set(r.nodeId, r.y + r.height / 2);

  const computeY = (id: NodeId): number => {
    const cached = yById.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf.get(id);
    if (!kids || kids.length === 0) {
      yById.set(id, 0);
      return 0;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const k of kids) {
      const y = computeY(k);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const y = (lo + hi) / 2;
    yById.set(id, y);
    return y;
  };
  computeY(tree.rootId);

  const nodes: TreeLayoutNode[] = [];
  for (const id of visible) {
    const n = tree.nodes[id];
    if (!n) continue;
    const row = endById.get(id);
    nodes.push({
      nodeId: id,
      parentId: n.parentId,
      x: xById.get(id) ?? drawingLeftX,
      y: yById.get(id) ?? 0,
      isVisibleEnd: row !== undefined,
      isLeaf: n.isLeaf,
      isCollapsedSummary: row?.kind === 'collapsedSummary',
    });
  }

  return { nodes, rootId: tree.rootId };
}
