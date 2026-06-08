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

export type TreeLayoutMode = 'phylogram' | 'cladogram';

export interface TreeLayoutInput {
  tree: Tree;
  visibleRows: VisibleRow[];
  drawingLeftX: number;
  drawingWidth: number;
  /**
   * 'phylogram' (default): x = cumulative branch-length distance from root.
   * 'cladogram': branch lengths are ignored; x is driven by topological
   * distance to the furthest descendant end, so all visible ends align at the
   * right edge. Suited to rank trees (e.g. a taxonomy) with no real branch
   * lengths.
   */
  layoutMode?: TreeLayoutMode;
}

/**
 * Tree layout. Pure function of (tree, visibleRows, drawing area, mode).
 * Defaults to a phylogram; pass `layoutMode: 'cladogram'` to ignore branch
 * lengths and align all visible ends at the right edge.
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

  const xById = new Map<NodeId, number>();
  if (input.layoutMode === 'cladogram') {
    // Cladogram: ignore branch lengths. heightToEnd(node) = max number of
    // edges from the node down to a visible end (0 at an end — leaf or
    // collapsed summary). x decreases with height, so every visible end lands
    // at the right edge and internal nodes sit left in proportion to their
    // subtree height. A collapsed clade reads as a tip in the aligned column.
    const heightToEnd = new Map<NodeId, number>();
    const computeHeight = (id: NodeId): number => {
      const cached = heightToEnd.get(id);
      if (cached !== undefined) return cached;
      if (endById.has(id)) {
        heightToEnd.set(id, 0);
        return 0;
      }
      let h = 0;
      for (const k of childrenOf.get(id) ?? []) {
        const kh = 1 + computeHeight(k);
        if (kh > h) h = kh;
      }
      heightToEnd.set(id, h);
      return h;
    };
    const maxHeight = computeHeight(tree.rootId);
    const xScale = maxHeight > 0 ? drawingWidth / maxHeight : 0;
    for (const id of visible) {
      const h = heightToEnd.get(id) ?? 0;
      xById.set(id, drawingLeftX + (maxHeight - h) * xScale);
    }
  } else {
    // Phylogram (default): cumulative distance from root via BFS. Each branch
    // contributes at least `MIN_BRANCH_DISTANCE` to the layout, so very-short
    // branches (zero-length, or measured-but-tiny like 1e-7 from a gene-tree
    // exporter) still get a visible horizontal segment instead of collapsing
    // onto their parent's x. The underlying `tree.nodes[child].distance` is
    // left untouched — the floor applies only to layout depth, not to data.
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
    for (const [id, d] of depth) xById.set(id, drawingLeftX + d * xScale);
  }

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

/** A run of single-visible-child internal nodes that has been collapsed
 *  into one fixed-width segment. */
export interface SpineSegment {
  /** The fork / root above the spine (parent of `startId`); null if the
   *  spine starts at the tree root. */
  entryId: NodeId | null;
  /** First pass-through node of the run — left end of the drawn pipe. */
  startId: NodeId;
  /** Exit node (a fork or visible end) — right end of the drawn pipe. */
  exitId: NodeId;
  /** Every pass-through node in the run, in top-to-bottom order. Used to
   *  re-anchor the pruned stubs they shed onto a single merged marker. */
  passThroughIds: NodeId[];
}

export interface SpineCompressionResult {
  /** Layout nodes with x positions rewritten so each collapsed run occupies
   *  `compressedWidth` instead of its natural span. */
  nodes: TreeLayoutNode[];
  /** Child ids whose incoming branch is inside a collapsed run and must not
   *  be drawn (the run is replaced by the pipe glyph). */
  branchSkip: Set<NodeId>;
  /** Internal-node glyph ids inside a collapsed run that must not be drawn. */
  glyphSkip: Set<NodeId>;
  segments: SpineSegment[];
  /** pass-through node id → index into `segments`, for merging the stubs
   *  those nodes anchor into the run's single marker. */
  anchorToSegment: Map<NodeId, number>;
}

/**
 * Collapse "spines" — maximal runs of single-visible-child internal nodes —
 * into fixed-width segments. After pruning a tree down to a sparse set of
 * leaves, the path from each surviving leaf up to the root threads through
 * long ladders of internal nodes that each have just one visible child (the
 * others pruned). Drawn literally, that ladder is a long branch carrying one
 * pruned stub per rung — visually noisy and uninformative.
 *
 * This generalises the root-path compression (which only collapses the single
 * chain hanging off the actual root) to every such run anywhere in the tree:
 * each run's internal branches/glyphs are suppressed, the run is squeezed to
 * `compressedWidth`, its downstream subtree shifts left to close the gap, and
 * the caller draws one pipe glyph plus one merged pruned stub per run.
 *
 * Pure function of the (already laid-out) nodes. Returns null when there's
 * nothing to collapse, so the caller can fall through to the raw layout.
 *
 * @param nodes        Laid-out nodes (typically post root-path compression).
 * @param rootId       Tree root id.
 * @param opts.compressedWidth  Target pixel span for each collapsed run.
 * @param opts.exclude  Node ids to treat as non-collapsible boundaries (e.g.
 *                      the root chain already handled by root-path compression).
 * @param opts.minChainLength  Minimum pass-through nodes for a run to qualify
 *                      (default 2 — a lone single-child node renders fine).
 */
export function compressSpines(
  nodes: readonly TreeLayoutNode[],
  rootId: NodeId | null,
  opts: {
    compressedWidth: number;
    exclude?: ReadonlySet<NodeId>;
    minChainLength?: number;
  },
): SpineCompressionResult | null {
  if (rootId === null || nodes.length === 0) return null;
  const W = opts.compressedWidth;
  const exclude = opts.exclude ?? new Set<NodeId>();
  const minChainLength = opts.minChainLength ?? 2;

  const byId = new Map<NodeId, TreeLayoutNode>();
  const childrenOf = new Map<NodeId, NodeId[]>();
  for (const n of nodes) {
    byId.set(n.nodeId, n);
    if (n.parentId === null) continue;
    let arr = childrenOf.get(n.parentId);
    if (!arr) {
      arr = [];
      childrenOf.set(n.parentId, arr);
    }
    arr.push(n.nodeId);
  }

  const isPassThrough = (id: NodeId): boolean => {
    const n = byId.get(id);
    if (!n || n.isVisibleEnd) return false;
    if (exclude.has(id)) return false;
    const kids = childrenOf.get(id);
    return !!kids && kids.length === 1;
  };

  const segments: SpineSegment[] = [];
  const branchSkip = new Set<NodeId>();
  const glyphSkip = new Set<NodeId>();
  const anchorToSegment = new Map<NodeId, number>();
  // exit id → entry id, so the x rewrite can place the exit at entry.x + W.
  const exitToEntry = new Map<NodeId, NodeId | null>();
  // pass-through id → entry id, so each collapses onto its run's entry x.
  const passToEntry = new Map<NodeId, NodeId | null>();

  for (const n of nodes) {
    if (!isPassThrough(n.nodeId)) continue;
    // Only start a run at its top: the parent must not itself be a
    // collapsible pass-through node.
    const parent = n.parentId;
    if (parent !== null && isPassThrough(parent)) continue;

    const run: NodeId[] = [n.nodeId];
    let cur = n.nodeId;
    // Walk down the single-child chain while each node is pass-through.
    for (;;) {
      const kids = childrenOf.get(cur);
      const child = kids && kids.length === 1 ? kids[0] : null;
      if (child !== null && isPassThrough(child)) {
        run.push(child);
        cur = child;
      } else {
        break;
      }
    }
    if (run.length < minChainLength) continue;
    const startId = run[0];
    const lastKids = childrenOf.get(run[run.length - 1]);
    const exitId = lastKids && lastKids.length === 1 ? lastKids[0] : null;
    if (exitId === null) continue; // defensive — pass-through has 1 child
    const entryId = byId.get(startId)?.parentId ?? null;

    const segIdx = segments.length;
    segments.push({ entryId, startId, exitId, passThroughIds: [...run] });
    exitToEntry.set(exitId, entryId);
    for (const id of run) {
      glyphSkip.add(id);
      anchorToSegment.set(id, segIdx);
      passToEntry.set(id, entryId);
    }
    // Skip the incoming branch of every node strictly below the run's start
    // (the start keeps its branch from the entry fork down to the spine).
    for (let i = 1; i < run.length; i++) branchSkip.add(run[i]);
    branchSkip.add(exitId);
  }

  if (segments.length === 0) return null;

  // Rewrite x by walking the visible tree from the root. Normal edges keep
  // their original horizontal extent (relative to the rewritten parent);
  // pass-through nodes collapse onto their run's entry x, and each run's exit
  // lands at entry.x + W — pulling its whole subtree left with it.
  const newX = new Map<NodeId, number>();
  const queue: NodeId[] = [rootId];
  const rootNode = byId.get(rootId);
  newX.set(rootId, rootNode ? rootNode.x : 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const px = newX.get(id) ?? 0;
    const ox = byId.get(id)?.x ?? 0;
    for (const childId of childrenOf.get(id) ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      let cx: number;
      if (passToEntry.has(childId)) {
        // Collapse onto the run's entry x (vertical-only entry elbow).
        const entry = passToEntry.get(childId) ?? null;
        cx = entry !== null ? (newX.get(entry) ?? px) : px;
      } else if (exitToEntry.has(childId)) {
        const entry = exitToEntry.get(childId) ?? null;
        const entryX = entry !== null ? (newX.get(entry) ?? px) : px;
        cx = entryX + W;
      } else {
        // Normal edge: preserve original horizontal delta from the parent.
        cx = px + (child.x - ox);
      }
      newX.set(childId, cx);
      queue.push(childId);
    }
  }

  const outNodes = nodes.map((n) =>
    newX.has(n.nodeId) ? { ...n, x: newX.get(n.nodeId)! } : n,
  );

  return { nodes: outNodes, branchSkip, glyphSkip, segments, anchorToSegment };
}
