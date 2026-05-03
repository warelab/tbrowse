import { useMemo, useRef } from 'react';
import { ancestorIdsOf, buildChildrenIndex, countLeavesInSubtree } from '../../treeIndex';
import type { NodeId, ZoneDefinition, ZoneRenderProps } from '../../types';
import { computeTreeLayout, type TreeLayoutNode } from './layout';
import { Tooltip } from './Tooltip';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';

// LEFT_PAD must be ≥ ROOT_STUB_LEN so the stub drawn left of the root has
// room inside the SVG. (The stub is what users hover/click to interact with
// the root node, since the root's own branch is zero-length.)
const LEFT_PAD = 16;
// RIGHT_PAD must be ≥ COLLAPSED_TRIANGLE_WIDTH so that when a collapsed-
// summary node ends up at the deepest visible depth (i.e. lands at
// drawingLeftX + drawingWidth) its triangle, which extends
// COLLAPSED_TRIANGLE_WIDTH to the right of the apex, doesn't overflow the
// zone's `overflow: hidden` clip and get cut off. Adds a few extra px of
// breathing room so the triangle's base doesn't sit flush against the
// labels-zone divider.
const RIGHT_PAD = 24;

// Theme-aware colour values: SVG presentation attributes accept var()
// references the same way `style` does, so we string them as
// `var(--name)` here and they re-evaluate when the theme class flips on
// the root.
const BRANCH_COLOR = 'var(--tbrowse-branch)';
const BRANCH_WIDTH = 1.5;
const HIGHLIGHT_COLOR = 'var(--tbrowse-accent)';
const HIGHLIGHT_WIDTH = 2.5;
const EXTENSION_COLOR = 'var(--tbrowse-leaf-extension)';
const EXTENSION_HIGHLIGHT_COLOR = 'var(--tbrowse-accent)';
// Selection amber stays fixed — it reads on both themes and is meant to
// be unambiguous.
const SELECT_COLOR = '#f59e0b';
const SELECT_RADIUS = 5;
const HIT_STROKE_WIDTH = 12;
const SPECIATION_COLOR = 'var(--tbrowse-text-muted)';
const DUPLICATION_COLOR = 'var(--tbrowse-danger)';
const NODE_GLYPH_RADIUS = 3.5;
/** Slightly smaller than the internal-node glyph so leaves read as
 *  terminal "ticks" rather than competing with the speciation circles. */
const LEAF_GLYPH_RADIUS = 2.5;
const NODE_GLYPH_SQUARE = 7;
// Bootstrap (0..100) maps to opacity multiplier in [BOOTSTRAP_MIN, 1].
// Lets low-confidence branches fade to ~40% without disappearing entirely.
const BOOTSTRAP_OPACITY_MIN = 0.4;
const COLLAPSED_TRIANGLE_WIDTH = 18;
/** Search-match highlight: an outer ring drawn around the leaf-tip
 *  glyph for matched leaves, and used to tint collapsed-summary
 *  triangles whose subtree contains at least one match. */
const SEARCH_MATCH_COLOR = 'var(--tbrowse-search, #fbbf24)';
const SEARCH_MATCH_RING_RADIUS = 5;
const SEARCH_MATCH_RING_WIDTH = 1.75;
/** Length of the visible/clickable horizontal stub drawn to the left of the
 *  root node so the root has a hit area (its own branch is zero-length). */
const ROOT_STUB_LEN = 10;
const COLLAPSED_TRIANGLE_MIN_H = 8;
const COLLAPSED_TRIANGLE_MAX_H = 22;
const COLLAPSED_TRIANGLE_FILL = 'rgba(128, 128, 140, 0.22)';
const COLLAPSED_TRIANGLE_STROKE = 'var(--tbrowse-text-muted)';

function collapsedTriangleHeight(leafCount: number): number {
  // Logarithmic so a 2-leaf and a 1000-leaf collapsed subtree are
  // distinguishable but both stay inside a single row's height.
  const h = 4 + Math.log2(Math.max(1, leafCount + 1)) * 4;
  return Math.max(COLLAPSED_TRIANGLE_MIN_H, Math.min(COLLAPSED_TRIANGLE_MAX_H, h));
}

/**
 * Visual style used when rendering "pruned-branch" markers — the little
 * affordances dangling off an anchor branch where the user has hidden a
 * subtree. The default `'square'` is the original look (hollow square at
 * the end of a dashed L-bend); the other options are alternatives we're
 * trialling — see the playground dropdown for live previews.
 */
export type PrunedNodeStyle =
  | 'square'
  | 'triangle'
  | 'cap'
  | 'slash'
  | 'scissors'
  | 'ellipsis'
  | 'ghost'
  | 'minitree'
  | 'count'
  | 'broken'
  | 'bracket';

export interface TreeZoneState {
  prunedNodeStyle?: PrunedNodeStyle;
}

const DEFAULT_PRUNED_STYLE: PrunedNodeStyle = 'triangle';

const TreeHeader = ({ width, hoveredNodeId, data }: ZoneRenderProps<TreeZoneState>) => {
  const hoveredInfo = useMemo(
    () => describeHoveredNode(hoveredNodeId, data),
    [hoveredNodeId, data],
  );
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 13,
        color: 'var(--tbrowse-text)',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px 0 18px',
        }}
      >
        <span style={{ fontWeight: 600 }}>Tree</span>
        <span style={{ fontWeight: 400, color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>{width}px</span>
      </div>
      {/* Second row: live readout of the hovered node. */}
      <div
        style={{
          flex: `0 0 ${LEAF_ROW_HEIGHT}px`,
          minHeight: 0,
          padding: '0 10px 0 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          color: 'var(--tbrowse-text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={hoveredInfo ?? ''}
      >
        {hoveredInfo ?? <span style={{ color: 'var(--tbrowse-text-subtle)' }}>hover a node…</span>}
      </div>
    </div>
  );
};

function describeHoveredNode(
  nodeId: NodeId | null,
  data: ZoneRenderProps['data'],
): string | null {
  if (!nodeId) return null;
  const node = data.tree.nodes[nodeId];
  if (!node) return nodeId;
  const parts: string[] = [];
  if (node.isLeaf) {
    parts.push('leaf');
    parts.push(node.geneId ?? node.id);
    if (node.taxonomyId !== undefined && data.taxonomy?.[node.taxonomyId]) {
      const tax = data.taxonomy[node.taxonomyId];
      const taxName = tax.commonName ?? tax.scientificName;
      if (taxName) parts.push(taxName);
    }
  } else {
    parts.push(node.eventType ?? 'internal');
    if (node.taxonomyId !== undefined && data.taxonomy?.[node.taxonomyId]) {
      const tax = data.taxonomy[node.taxonomyId];
      const taxName = tax.scientificName ?? tax.commonName;
      if (taxName) parts.push(taxName);
      if (tax.rank) parts.push(tax.rank);
    }
  }
  return parts.join(' · ');
}

const TreeBody = ({
  data,
  visibleRows,
  rowRange,
  width,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  collapsedNodeIds,
  prunedNodeIds,
  swappedNodeIds,
  compressedNodeIds,
  searchResults,
  nodeOfInterestId,
  onHoverNode,
  onSelectNode,
  onClearSelection,
  onToggleCollapsed,
  onTogglePruned,
  onToggleSwapped,
  onToggleCompressed,
  onExpandSubtree,
  onMakeNodeOfInterest,
  onShowParalogs,
  onReroot,
  onRegrowOthers,
  zoneState,
}: ZoneRenderProps<TreeZoneState>) => {
  const prunedNodeStyle = zoneState.prunedNodeStyle ?? DEFAULT_PRUNED_STYLE;
  const drawingWidth = Math.max(0, width - LEFT_PAD - RIGHT_PAD);
  const svgRef = useRef<SVGSVGElement>(null);

  // Auto-compression: branches whose distance is more than 5× the median
  // are flagged for visual shortening so a single outlier doesn't squash
  // the rest of the tree. The user can override per-branch via the
  // tooltip; the override flips whatever the auto rule decided
  // (XOR semantics). The actual shortening happens later, in pixel space,
  // post-layout.
  const autoCompressed = useMemo(() => {
    const distances: number[] = [];
    for (const n of Object.values(data.tree.nodes)) {
      if (n.parentId !== null && n.distance > 0) distances.push(n.distance);
    }
    if (distances.length < 5) return new Set<NodeId>();
    const sorted = [...distances].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) return new Set<NodeId>();
    const threshold = median * 5;
    const out = new Set<NodeId>();
    for (const n of Object.values(data.tree.nodes)) {
      if (n.parentId !== null && n.distance > threshold) out.add(n.id);
    }
    return out;
  }, [data.tree]);

  // Effective compression set = auto-detected XOR per-node overrides.
  const effectiveCompressed = useMemo(() => {
    const out = new Set<NodeId>(autoCompressed);
    for (const id of compressedNodeIds) {
      if (out.has(id)) out.delete(id);
      else out.add(id);
    }
    return out;
  }, [autoCompressed, compressedNodeIds]);

  // For the tooltip's "Compress / Uncompress branch" label we also need
  // to know whether a single node is currently compressed. Local helper.
  const isCompressed = (id: NodeId) => effectiveCompressed.has(id);

  // Per-internal-node count of matched leaves anywhere in its subtree.
  // Drives the badge on collapsed-summary triangles so the user can
  // tell "this triangle hides 3 matches" without expanding it.
  // O(matches × depth); cheap given the 10k-match cap.
  const subtreeMatchCounts = useMemo(() => {
    const counts = new Map<NodeId, number>();
    if (searchResults.matchedLeafIds.size === 0) return counts;
    for (const leafId of searchResults.matchedLeafIds) {
      let cur = data.tree.nodes[leafId]?.parentId ?? null;
      while (cur !== null) {
        counts.set(cur, (counts.get(cur) ?? 0) + 1);
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
    }
    return counts;
  }, [searchResults.matchedLeafIds, data.tree]);

  // Raw layout (no compression). Pixel positions come from branch-length
  // depth × xScale where xScale = drawingWidth / maxEndDepth.
  const rawLayout = useMemo(
    () =>
      computeTreeLayout({
        tree: data.tree,
        visibleRows,
        drawingLeftX: LEFT_PAD,
        drawingWidth,
      }),
    [data.tree, visibleRows, drawingWidth],
  );

  // Compression in pixel space. Each compressed branch is first shortened
  // to at most `0.1 × drawingWidth` pixels (never lengthened); descendants
  // shift left by the same amount so their relative geometry is preserved.
  // After compression, the layout is RESCALED so the rightmost visible
  // end-node still lands at `drawingLeftX + drawingWidth` — otherwise the
  // tree would leave whitespace on the right, and the leaf-extension
  // dashes would stretch across the gap to bridge the labels zone. The
  // 0.1 cap therefore acts as a *relative* shortening guideline rather
  // than a hard pixel limit.
  const layout = useMemo(() => {
    if (effectiveCompressed.size === 0 || drawingWidth <= 0) return rawLayout;
    const maxBranchPx = drawingWidth * 0.1;
    const byIdRaw = new Map(rawLayout.nodes.map((n) => [n.nodeId, n]));
    const childrenIdx = new Map<NodeId, NodeId[]>();
    for (const n of rawLayout.nodes) {
      if (n.parentId === null) continue;
      const arr = childrenIdx.get(n.parentId);
      if (arr) arr.push(n.nodeId);
      else childrenIdx.set(n.parentId, [n.nodeId]);
    }
    const newX = new Map<NodeId, number>();
    const queue: NodeId[] = [];
    if (rawLayout.rootId) {
      newX.set(rawLayout.rootId, byIdRaw.get(rawLayout.rootId)!.x);
      queue.push(rawLayout.rootId);
    }
    while (queue.length > 0) {
      const id = queue.shift()!;
      const parentRawX = byIdRaw.get(id)!.x;
      const parentNewX = newX.get(id)!;
      for (const childId of childrenIdx.get(id) ?? []) {
        const child = byIdRaw.get(childId)!;
        const rawBranchPx = child.x - parentRawX;
        const branchPx = effectiveCompressed.has(childId)
          ? Math.min(rawBranchPx, maxBranchPx)
          : rawBranchPx;
        newX.set(childId, parentNewX + branchPx);
        queue.push(childId);
      }
    }
    // Rescale so the rightmost VISIBLE END (leaf or collapsed summary)
    // sits at the right edge of the drawing area, the same invariant
    // computeTreeLayout enforces for the raw layout.
    let maxEndX = LEFT_PAD;
    for (const n of rawLayout.nodes) {
      if (!n.isVisibleEnd) continue;
      const adj = newX.get(n.nodeId) ?? n.x;
      if (adj > maxEndX) maxEndX = adj;
    }
    const span = maxEndX - LEFT_PAD;
    const scale = span > 0 ? drawingWidth / span : 1;
    return {
      rootId: rawLayout.rootId,
      nodes: rawLayout.nodes.map((n) => {
        const adj = newX.get(n.nodeId) ?? n.x;
        return { ...n, x: LEFT_PAD + (adj - LEFT_PAD) * scale };
      }),
    };
  }, [rawLayout, effectiveCompressed, drawingWidth]);

  const ancestorsHighlight = useMemo<ReadonlySet<NodeId>>(() => {
    if (hoveredNodeId === null) return new Set();
    return ancestorIdsOf(data.tree, hoveredNodeId);
  }, [hoveredNodeId, data.tree]);

  const fullChildrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);

  const byId = useMemo(() => {
    const m = new Map<string, TreeLayoutNode>();
    for (const n of layout.nodes) m.set(n.nodeId, n);
    return m;
  }, [layout]);

  // Per-node opacity for the animation pipeline. Visible-end rows (leaves
  // and collapsed-summaries) carry an opacity hint via visibleRows; an
  // internal node inherits the max opacity of any visible-end in its
  // subtree, so branches in a fading subtree all fade together.
  const opacityById = useMemo(() => {
    const m = new Map<NodeId, number>();
    for (const n of layout.nodes) m.set(n.nodeId, 0);
    for (const r of visibleRows) m.set(r.nodeId, r.opacity ?? 1);
    for (const r of visibleRows) {
      const op = r.opacity ?? 1;
      let cur: NodeId | null = data.tree.nodes[r.nodeId]?.parentId ?? null;
      while (cur !== null) {
        if (!m.has(cur)) break;
        const curOp = m.get(cur) ?? 0;
        if (op > curOp) m.set(cur, op);
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
    }
    return m;
  }, [layout, visibleRows, data.tree]);

  // Pruned-node stub glyphs: one per pruned id, placed adjacent to its
  // anchor's branch at a small fixed offset. The side (above or below) is
  // chosen to match where the pruned branch came from — and where it will
  // regrow back to — based on its position in the anchor's original
  // children list.
  const prunedStubs = useMemo(() => {
    const STUB_OFFSET = 6;
    const STUB_STEP = 8;
    const STUB_LEN = 12;

    // Group pruned ids by closest visible ancestor.
    const byAnchor = new Map<NodeId, NodeId[]>();
    for (const prunedId of prunedNodeIds) {
      let cur: NodeId | null = data.tree.nodes[prunedId]?.parentId ?? null;
      while (cur !== null && !byId.has(cur)) {
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
      if (cur === null) continue;
      let arr = byAnchor.get(cur);
      if (!arr) {
        arr = [];
        byAnchor.set(cur, arr);
      }
      arr.push(prunedId);
    }

    type Stub = {
      prunedId: NodeId;
      anchorX: number;
      anchorY: number;
      stubY: number;
      markX: number;
      markY: number;
      /** Leaf count of the pruned subtree (used by the "count" style). */
      leafCount: number;
    };
    const stubs: Stub[] = [];

    for (const [anchorId, ids] of byAnchor) {
      const anchor = byId.get(anchorId);
      if (!anchor) continue;

      // Swap inverts the visual order of children, so the "side" a pruned
      // branch sits on flips when the anchor is swapped.
      const rawChildren = fullChildrenIndex.get(anchorId) ?? [];
      const fullChildren = swappedNodeIds.has(anchorId)
        ? [...rawChildren].reverse()
        : rawChildren;
      const visibleIndices: number[] = [];
      fullChildren.forEach((cid, idx) => {
        if (byId.has(cid)) visibleIndices.push(idx);
      });
      // Avg index of visible siblings — split point between "above" and "below".
      const visibleAvg =
        visibleIndices.length > 0
          ? visibleIndices.reduce((a, b) => a + b, 0) / visibleIndices.length
          : 0;

      type Tagged = { prunedId: NodeId; baIdx: number; above: boolean };
      const tagged: Tagged[] = ids.map((prunedId) => {
        // Walk up from prunedId until parent === anchor; cur ends up as the
        // direct child of anchor on the path to prunedId (the "branch
        // ancestor").
        let cur: NodeId = prunedId;
        let parent: NodeId | null =
          data.tree.nodes[prunedId]?.parentId ?? null;
        while (parent !== null && parent !== anchorId) {
          cur = parent;
          parent = data.tree.nodes[parent]?.parentId ?? null;
        }
        const baIdx = fullChildren.indexOf(cur);
        // Below visibleAvg → branch came from above the anchor (lower-index
        // siblings sit higher in the tree visualization). Tie → below.
        const above = baIdx >= 0 && baIdx < visibleAvg;
        return { prunedId, baIdx, above };
      });

      // Stack stubs on each side, stacking outward by sibling order so the
      // ones farthest from the visible siblings end up farthest from the
      // anchor.
      const aboveSide = tagged
        .filter((t) => t.above)
        .sort((a, b) => b.baIdx - a.baIdx);
      const belowSide = tagged
        .filter((t) => !t.above)
        .sort((a, b) => a.baIdx - b.baIdx);

      aboveSide.forEach((t, j) => {
        const stubY = anchor.y - (STUB_OFFSET + j * STUB_STEP);
        stubs.push({
          prunedId: t.prunedId,
          anchorX: anchor.x,
          anchorY: anchor.y,
          stubY,
          markX: anchor.x + STUB_LEN,
          markY: stubY,
          leafCount: countLeavesInSubtree(t.prunedId, data.tree, fullChildrenIndex),
        });
      });
      belowSide.forEach((t, j) => {
        const stubY = anchor.y + (STUB_OFFSET + j * STUB_STEP);
        stubs.push({
          prunedId: t.prunedId,
          anchorX: anchor.x,
          anchorY: anchor.y,
          stubY,
          markX: anchor.x + STUB_LEN,
          markY: stubY,
          leafCount: countLeavesInSubtree(t.prunedId, data.tree, fullChildrenIndex),
        });
      });
    }
    return stubs;
  }, [prunedNodeIds, data.tree, byId, fullChildrenIndex, swappedNodeIds]);

  const isHighlighted = (nodeId: NodeId): boolean =>
    hoveredSubtreeIds.has(nodeId) || ancestorsHighlight.has(nodeId);

  /** Confidence factor in [BOOTSTRAP_OPACITY_MIN, 1] from a node's bootstrap. */
  const bootstrapFactor = (nodeId: NodeId): number => {
    const bs = data.tree.nodes[nodeId]?.bootstrap;
    if (bs === undefined) return 1;
    const t = Math.max(0, Math.min(100, bs)) / 100;
    return BOOTSTRAP_OPACITY_MIN + (1 - BOOTSTRAP_OPACITY_MIN) * t;
  };

  // Would pruning the selected node empty the tree (no active leaves left)?
  // An active leaf is one whose ancestor chain contains no pruned node. The
  // prune button is disabled in that case (regrow is always allowed).
  const pruneWouldEmptyTree = useMemo(() => {
    if (selectedNodeId === null) return false;
    if (prunedNodeIds.has(selectedNodeId)) return false;
    const node = data.tree.nodes[selectedNodeId];
    if (!node) return false;
    // Collect the selected node's subtree (the would-be-pruned set).
    const subtree = new Set<NodeId>();
    const stack: NodeId[] = [selectedNodeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (subtree.has(id)) continue;
      subtree.add(id);
      const kids = fullChildrenIndex.get(id);
      if (kids) for (const k of kids) stack.push(k);
    }
    // Look for any active leaf outside that subtree.
    for (const n of Object.values(data.tree.nodes)) {
      if (!n.isLeaf) continue;
      if (subtree.has(n.id)) continue;
      let cur: NodeId | null = n.id;
      let blocked = false;
      while (cur !== null) {
        if (prunedNodeIds.has(cur)) {
          blocked = true;
          break;
        }
        cur = data.tree.nodes[cur]?.parentId ?? null;
      }
      if (!blocked) return false;
    }
    return true;
  }, [selectedNodeId, prunedNodeIds, fullChildrenIndex, data.tree]);

  // For the tooltip's "Expand all" affordance: does the selected node's
  // subtree contain any currently-collapsed internal node? Only relevant
  // when the selected node itself is internal and not currently collapsed.
  // Hooked here (rather than later, near the tooltip-related locals) so it
  // sits BEFORE any conditional early return — React requires every render
  // to call the same hooks in the same order.
  const selectedHasCollapsedDescendants = useMemo(() => {
    if (selectedNodeId === null) return false;
    const node = data.tree.nodes[selectedNodeId];
    if (!node || node.isLeaf) return false;
    if (collapsedNodeIds.has(selectedNodeId)) return false;
    if (collapsedNodeIds.size === 0) return false;
    const stack: NodeId[] = [...(fullChildrenIndex.get(selectedNodeId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (collapsedNodeIds.has(id)) return true;
      const kids = fullChildrenIndex.get(id);
      if (kids) for (const k of kids) stack.push(k);
    }
    return false;
  }, [selectedNodeId, data.tree, collapsedNodeIds, fullChildrenIndex]);

  // For the tooltip's "Prune others / Regrow others" toggle: are any of
  // the sibling-branch top-level nodes between the selected node and the
  // root currently pruned? Determines which label the button shows.
  const selectedOthersArePruned = useMemo(() => {
    if (selectedNodeId === null) return false;
    if (prunedNodeIds.size === 0) return false;
    const path = new Set<NodeId>();
    let cur: NodeId | null = selectedNodeId;
    while (cur !== null) {
      path.add(cur);
      cur = data.tree.nodes[cur]?.parentId ?? null;
    }
    if (path.size <= 1) return false;
    for (const ancestorId of path) {
      if (ancestorId === selectedNodeId) continue;
      const kids = fullChildrenIndex.get(ancestorId);
      if (!kids) continue;
      for (const k of kids) {
        if (!path.has(k) && prunedNodeIds.has(k)) return true;
      }
    }
    return false;
  }, [selectedNodeId, data.tree, fullChildrenIndex, prunedNodeIds]);

  if (layout.nodes.length === 0) return null;

  const totalHeight =
    visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
      : 0;

  const extensionEndX = width - 1;

  // Virtualization: only render branches/glyphs that intersect the visible
  // y-range. The chassis already supplies rowRange (with its own overscan).
  // For branches we use range overlap because a branch's vertical segment
  // can span y values outside both endpoints' rows.
  const firstVisibleRow = visibleRows[Math.max(0, rowRange.startIndex)];
  const lastVisibleRow =
    visibleRows[Math.max(0, Math.min(visibleRows.length - 1, rowRange.endIndex - 1))];
  const visibleStartY = firstVisibleRow ? firstVisibleRow.y : 0;
  const visibleEndY = lastVisibleRow
    ? lastVisibleRow.y + lastVisibleRow.height
    : totalHeight;

  const yInRange = (y: number) => y >= visibleStartY && y <= visibleEndY;
  const branchInRange = (parentY: number, childY: number) => {
    const lo = parentY < childY ? parentY : childY;
    const hi = parentY < childY ? childY : parentY;
    return hi >= visibleStartY && lo <= visibleEndY;
  };

  // The tooltip needs a (x, y) anchor for any selected node. Visible nodes
  // come from the layout; pruned nodes don't appear in the layout, so we
  // synthesize an anchor at their stub mark position.
  const selectedTreeNode =
    selectedNodeId !== null ? data.tree.nodes[selectedNodeId] : null;
  let selectedLayoutNode: TreeLayoutNode | null =
    selectedNodeId !== null ? (byId.get(selectedNodeId) ?? null) : null;
  if (!selectedLayoutNode && selectedNodeId !== null && prunedNodeIds.has(selectedNodeId)) {
    const stub = prunedStubs.find((s) => s.prunedId === selectedNodeId);
    if (stub && selectedTreeNode) {
      selectedLayoutNode = {
        nodeId: selectedNodeId,
        parentId: selectedTreeNode.parentId,
        x: stub.markX,
        y: stub.markY,
        isVisibleEnd: false,
        isLeaf: selectedTreeNode.isLeaf,
        isCollapsedSummary: false,
      };
    }
  }

  const selectedSubtreeLeafCount =
    selectedNodeId !== null && selectedTreeNode && !selectedTreeNode.isLeaf
      ? countLeavesInSubtree(selectedNodeId, data.tree, fullChildrenIndex)
      : 0;

  return (
    <>
      <svg
        ref={svgRef}
        width={width}
        height={totalHeight}
        style={{ display: 'block', shapeRendering: 'crispEdges' }}
        onMouseLeave={() => onHoverNode(null)}
      >
        {/* Background hit rect — clicks here clear selection. Sits at the
            bottom of the z-order; all interactive elements below cover it. */}
        <rect
          x={0}
          y={0}
          width={width}
          height={totalHeight}
          fill="transparent"
          onClick={onClearSelection}
        />
        {/* Row hit areas. Full-row click target for each visible end so
            hovering anywhere in the row outside the branch still hits. */}
        <g>
          {layout.nodes.map((n) => {
            if (!n.isVisibleEnd) return null;
            const r = visibleRows.find((row) => row.nodeId === n.nodeId);
            if (!r) return null;
            if (!yInRange(r.y)) return null;
            return (
              <rect
                key={`row-${n.nodeId}`}
                x={0}
                y={r.y}
                width={width}
                height={r.height}
                fill="transparent"
                onMouseEnter={() => onHoverNode(n.nodeId)}
                onClick={() => onSelectNode(n.nodeId)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </g>
        {/* Root stub: a short horizontal segment to the left of the root so
            the root node has something visible to hover and click. */}
        {(() => {
          if (!layout.rootId) return null;
          const root = byId.get(layout.rootId);
          if (!root) return null;
          if (!yInRange(root.y)) return null;
          const hl = isHighlighted(root.nodeId);
          return (
            <line
              key="b-root"
              x1={root.x - ROOT_STUB_LEN}
              y1={root.y}
              x2={root.x}
              y2={root.y}
              stroke={hl ? HIGHLIGHT_COLOR : BRANCH_COLOR}
              strokeWidth={hl ? HIGHLIGHT_WIDTH : BRANCH_WIDTH}
              pointerEvents="none"
            />
          );
        })()}
        {/* Visible branches. During animation a fading-out child retracts
            toward its parent (right→left for collapse/prune) and a
            fading-in child extends from its parent (left→right for
            expand/regrow). The parent end stays anchored. */}
        <g pointerEvents="none">
          {layout.nodes.map((child) => {
            if (child.parentId === null) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!branchInRange(parent.y, child.y)) return null;
            const opacity = opacityById.get(child.nodeId) ?? 1;
            const childX = parent.x + (child.x - parent.x) * opacity;
            const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${childX} ${child.y}`;
            const hl = isHighlighted(child.nodeId);
            return (
              <path
                key={`b-${child.nodeId}`}
                d={d}
                stroke={hl ? HIGHLIGHT_COLOR : BRANCH_COLOR}
                strokeWidth={hl ? HIGHLIGHT_WIDTH : BRANCH_WIDTH}
                fill="none"
                opacity={opacity * bootstrapFactor(child.nodeId)}
              />
            );
          })}
        </g>
        {/* Branch-compression glyphs. Two short diagonal slashes ("//") at
            the midpoint of each compressed horizontal segment, signalling
            that the rendered length is shorter than the actual branch
            length. Drawn after the branches so they overlay the line. */}
        <g pointerEvents="none">
          {layout.nodes.map((child) => {
            if (child.parentId === null) return null;
            if (!effectiveCompressed.has(child.nodeId)) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!yInRange(child.y)) return null;
            const opacity = opacityById.get(child.nodeId) ?? 1;
            const childX = parent.x + (child.x - parent.x) * opacity;
            const midX = (parent.x + childX) / 2;
            const hl = isHighlighted(child.nodeId);
            const stroke = hl ? HIGHLIGHT_COLOR : BRANCH_COLOR;
            // Two diagonal slashes 3px apart, ±3px tall.
            return (
              <g key={`bc-${child.nodeId}`} opacity={opacity}>
                <line
                  x1={midX - 3}
                  y1={child.y + 3}
                  x2={midX}
                  y2={child.y - 3}
                  stroke={stroke}
                  strokeWidth={1.2}
                />
                <line
                  x1={midX}
                  y1={child.y + 3}
                  x2={midX + 3}
                  y2={child.y - 3}
                  stroke={stroke}
                  strokeWidth={1.2}
                />
              </g>
            );
          })}
        </g>
        {/* Leaf extensions. Tracked to the leaf's interpolated x so the
            extension visibly anchors to where the branch tip currently is.
            For collapsed-summary nodes the extension starts past the
            triangle's base. */}
        <g pointerEvents="none">
          {layout.nodes.map((n) => {
            if (!n.isVisibleEnd) return null;
            if (!yInRange(n.y)) return null;
            const hl = isHighlighted(n.nodeId);
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const tipX = parent
              ? parent.x + (n.x - parent.x) * opacity
              : n.x;
            const extStart = n.isCollapsedSummary
              ? tipX + COLLAPSED_TRIANGLE_WIDTH
              : tipX;
            if (extStart >= extensionEndX) return null;
            return (
              <line
                key={`e-${n.nodeId}`}
                x1={extStart}
                y1={n.y}
                x2={extensionEndX}
                y2={n.y}
                stroke={hl ? EXTENSION_HIGHLIGHT_COLOR : EXTENSION_COLOR}
                strokeWidth={hl ? 1.5 : 1}
                strokeDasharray="2 3"
                opacity={opacity * bootstrapFactor(n.nodeId)}
              />
            );
          })}
        </g>
        {/* Collapsed-summary triangles. Apex at the (interpolated) branch
            tip; base extends right by COLLAPSED_TRIANGLE_WIDTH; vertical
            base height scales (logarithmically) with the subtree's leaf
            count, capped to fit within a single row. Triangles whose
            subtree contains search matches get the search-match stroke
            colour and a small count badge to the right of the base. */}
        <g pointerEvents="none">
          {layout.nodes.map((n) => {
            if (!n.isCollapsedSummary) return null;
            if (!yInRange(n.y)) return null;
            const row = visibleRows.find((r) => r.nodeId === n.nodeId);
            if (!row) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const apexX = parent
              ? parent.x + (n.x - parent.x) * opacity
              : n.x;
            const baseX = apexX + COLLAPSED_TRIANGLE_WIDTH;
            const h = collapsedTriangleHeight(row.leafCount);
            const top = n.y - h / 2;
            const bot = n.y + h / 2;
            const matchCount = subtreeMatchCounts.get(n.nodeId) ?? 0;
            return (
              <g key={`c-${n.nodeId}`} opacity={opacity}>
                <polygon
                  points={`${apexX},${n.y} ${baseX},${top} ${baseX},${bot}`}
                  fill={COLLAPSED_TRIANGLE_FILL}
                  stroke={
                    matchCount > 0
                      ? SEARCH_MATCH_COLOR
                      : COLLAPSED_TRIANGLE_STROKE
                  }
                  strokeWidth={matchCount > 0 ? 1.75 : 1}
                >
                  <title>
                    {matchCount > 0
                      ? `Collapsed (${row.leafCount} leaves, ${matchCount} matching)`
                      : `Collapsed (${row.leafCount} leaves)`}
                  </title>
                </polygon>
                {matchCount > 0 && (
                  <text
                    x={baseX + 3}
                    y={n.y + 3}
                    fontSize={10}
                    fontWeight={600}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fill={SEARCH_MATCH_COLOR}
                  >
                    {matchCount}
                  </text>
                )}
              </g>
            );
          })}
        </g>
        {/* Internal-node glyphs. Speciation → small filled circle;
            duplication → small filled square. Position tracks the branch
            tip during collapse/expand/prune/regrow animations so the
            glyph sits at the visible bend even mid-animation. */}
        <g pointerEvents="none">
          {layout.nodes.map((n) => {
            if (n.isLeaf) return null;
            if (n.isVisibleEnd) return null; // collapsed-summary; render its own marker if needed elsewhere
            if (!yInRange(n.y)) return null;
            const treeNode = data.tree.nodes[n.nodeId];
            if (!treeNode) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const glyphX = parent ? parent.x + (n.x - parent.x) * opacity : n.x;
            const finalOpacity = opacity * bootstrapFactor(n.nodeId);
            const isDuplication = treeNode.eventType === 'duplication';
            if (isDuplication) {
              return (
                <rect
                  key={`g-${n.nodeId}`}
                  x={glyphX - NODE_GLYPH_SQUARE / 2}
                  y={n.y - NODE_GLYPH_SQUARE / 2}
                  width={NODE_GLYPH_SQUARE}
                  height={NODE_GLYPH_SQUARE}
                  fill={DUPLICATION_COLOR}
                  opacity={finalOpacity}
                >
                  <title>{`duplication${treeNode.bootstrap !== undefined ? ` · bootstrap ${treeNode.bootstrap}` : ''}`}</title>
                </rect>
              );
            }
            return (
              <circle
                key={`g-${n.nodeId}`}
                cx={glyphX}
                cy={n.y}
                r={NODE_GLYPH_RADIUS}
                fill={SPECIATION_COLOR}
                opacity={finalOpacity}
              >
                <title>{`${treeNode.eventType ?? 'speciation'}${treeNode.bootstrap !== undefined ? ` · bootstrap ${treeNode.bootstrap}` : ''}`}</title>
              </circle>
            );
          })}
        </g>
        {/* Leaf-node glyphs. Small filled circle in the branch colour at
            each visible leaf's branch tip, tracking the same interpolated
            x as the leaf-extension start so it slides smoothly during
            collapse / expand / prune / regrow animations. Search-matched
            leaves additionally get an outer ring in the search-match
            colour so they pop against the rest of the tree. */}
        <g pointerEvents="none">
          {layout.nodes.map((n) => {
            if (!n.isLeaf) return null;
            if (n.isCollapsedSummary) return null;
            if (!yInRange(n.y)) return null;
            const treeNode = data.tree.nodes[n.nodeId];
            if (!treeNode) return null;
            const opacity = opacityById.get(n.nodeId) ?? 1;
            const parent = n.parentId !== null ? byId.get(n.parentId) : null;
            const tipX = parent ? parent.x + (n.x - parent.x) * opacity : n.x;
            const finalOpacity = opacity * bootstrapFactor(n.nodeId);
            const isSearchMatch = searchResults.matchedLeafIds.has(n.nodeId);
            return (
              <g key={`l-${n.nodeId}`} opacity={finalOpacity}>
                {isSearchMatch && (
                  <circle
                    cx={tipX}
                    cy={n.y}
                    r={SEARCH_MATCH_RING_RADIUS}
                    fill="none"
                    stroke={SEARCH_MATCH_COLOR}
                    strokeWidth={SEARCH_MATCH_RING_WIDTH}
                  />
                )}
                <circle
                  cx={tipX}
                  cy={n.y}
                  r={LEAF_GLYPH_RADIUS}
                  fill={BRANCH_COLOR}
                >
                  <title>{treeNode.geneId ?? n.nodeId}</title>
                </circle>
              </g>
            );
          })}
        </g>
        {/* Selection marker. Skipped for pruned nodes — those already
            highlight via the stub's own selected-state colour, and an
            extra circle on top would obscure the marker glyph. */}
        {selectedLayoutNode &&
          selectedNodeId !== null &&
          !prunedNodeIds.has(selectedNodeId) && (
            <circle
              cx={selectedLayoutNode.x}
              cy={selectedLayoutNode.y}
              r={SELECT_RADIUS}
              fill={SELECT_COLOR}
              stroke="white"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          )}
        {/* Branch hit areas. Top of stack so they win over row rects on
            overlaps. */}
        <g>
          {layout.rootId &&
            (() => {
              const root = byId.get(layout.rootId);
              if (!root) return null;
              if (!yInRange(root.y)) return null;
              return (
                <line
                  key="h-root"
                  x1={root.x - ROOT_STUB_LEN}
                  y1={root.y}
                  x2={root.x}
                  y2={root.y}
                  stroke="transparent"
                  strokeWidth={HIT_STROKE_WIDTH}
                  onMouseEnter={() => onHoverNode(root.nodeId)}
                  onClick={() => onSelectNode(root.nodeId)}
                  style={{ cursor: 'pointer' }}
                />
              );
            })()}
          {layout.nodes.map((child) => {
            if (child.parentId === null) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            if (!branchInRange(parent.y, child.y)) return null;
            const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${child.x} ${child.y}`;
            return (
              <path
                key={`h-${child.nodeId}`}
                d={d}
                stroke="transparent"
                strokeWidth={HIT_STROKE_WIDTH}
                fill="none"
                onMouseEnter={() => onHoverNode(child.nodeId)}
                onClick={() => onSelectNode(child.nodeId)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
        </g>
        {/* Pruned-branch stub glyphs. Rendered LAST so they sit above the
            branch hit paths in the SVG z-order and reliably capture clicks.
            One glyph per pruned id; each draws a tiny dashed stump where
            its branch was sheared off, pointing in the original branch's
            direction. The stub's y comes from the shadow layout so when
            the user regrows, the new branch lands at the same y the stub
            was indicating. */}
        <g>
          {prunedStubs.map((stub) => {
            if (!yInRange(stub.markY) && !yInRange(stub.anchorY)) return null;
            const isSelected = selectedNodeId === stub.prunedId;
            return (
              <g
                key={`pstub-${stub.prunedId}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(stub.prunedId);
                }}
              >
                {renderPrunedStub(prunedNodeStyle, stub, isSelected)}
                {/* Forgiving transparent click target. Centered on the
                    marker; same r across styles for consistent feel. */}
                <circle cx={stub.markX} cy={stub.markY} r={9} fill="transparent" />
                <title>{`Click to inspect pruned subtree (${stub.prunedId})`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      {selectedLayoutNode && selectedTreeNode && selectedNodeId !== null && (
        <Tooltip
          svgRef={svgRef}
          layoutNode={selectedLayoutNode}
          treeNode={selectedTreeNode}
          data={data}
          isCollapsed={collapsedNodeIds.has(selectedNodeId)}
          isPruned={prunedNodeIds.has(selectedNodeId)}
          isCompressed={isCompressed(selectedNodeId)}
          isNodeOfInterest={nodeOfInterestId === selectedNodeId}
          subtreeLeafCount={selectedSubtreeLeafCount}
          hasCollapsedDescendants={selectedHasCollapsedDescendants}
          pruneWouldEmptyTree={pruneWouldEmptyTree}
          onClose={onClearSelection}
          onToggleCollapsed={onToggleCollapsed}
          onTogglePruned={onTogglePruned}
          onToggleSwapped={onToggleSwapped}
          onToggleCompressed={onToggleCompressed}
          onExpandSubtree={onExpandSubtree}
          onMakeNodeOfInterest={onMakeNodeOfInterest}
          onShowParalogs={onShowParalogs}
          onReroot={onReroot}
          onRegrowOthers={onRegrowOthers}
          othersArePruned={selectedOthersArePruned}
        />
      )}
    </>
  );
};

/**
 * Render the connector + terminal-mark for a single pruned stub in the
 * given style. The connector goes from the anchor branch down/up to a
 * horizontal stub at `stubY`, and the marker sits at (markX, markY).
 *
 * Each branch of the switch is independent; styles are easy to add or tweak.
 */
function renderPrunedStub(
  style: PrunedNodeStyle,
  stub: {
    prunedId: NodeId;
    anchorX: number;
    anchorY: number;
    stubY: number;
    markX: number;
    markY: number;
    leafCount: number;
  },
  isSelected: boolean,
) {
  const stroke = isSelected ? HIGHLIGHT_COLOR : '#888';
  const fill = isSelected ? HIGHLIGHT_COLOR : 'white';
  const text = isSelected ? HIGHLIGHT_COLOR : '#666';
  const dashedL = (
    <path
      d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${stub.markX} ${stub.stubY}`}
      fill="none"
      stroke={stroke}
      strokeWidth={1}
      strokeDasharray="2 2"
      pointerEvents="none"
    />
  );
  const solidL = (
    <path
      d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${stub.markX} ${stub.stubY}`}
      fill="none"
      stroke={stroke}
      strokeWidth={1}
      pointerEvents="none"
    />
  );
  const mx = stub.markX;
  const my = stub.markY;
  switch (style) {
    case 'square':
      return (
        <>
          {dashedL}
          <rect
            x={mx - 3}
            y={my - 3}
            width={6}
            height={6}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </>
      );
    case 'triangle':
      // Left-pointing isosceles triangle; apex on the left, base on the
      // right — same orientation as the live collapsed-clade triangles.
      return (
        <>
          {dashedL}
          <polygon
            points={`${mx - 4},${my} ${mx + 4},${my - 4} ${mx + 4},${my + 4}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </>
      );
    case 'cap':
      // Dashed L ending in a short vertical "⊣" cap. No terminal glyph.
      return (
        <>
          {dashedL}
          <line
            x1={mx}
            y1={my - 4}
            x2={mx}
            y2={my + 4}
            stroke={stroke}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        </>
      );
    case 'slash':
      return (
        <>
          {dashedL}
          <rect
            x={mx - 3}
            y={my - 3}
            width={6}
            height={6}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <line
            x1={mx - 3}
            y1={my + 3}
            x2={mx + 3}
            y2={my - 3}
            stroke={stroke}
            strokeWidth={1.2}
            pointerEvents="none"
          />
        </>
      );
    case 'scissors':
      // Two short crossed strokes forming an "x".
      return (
        <>
          {dashedL}
          <line
            x1={mx - 3}
            y1={my - 3}
            x2={mx + 3}
            y2={my + 3}
            stroke={stroke}
            strokeWidth={1.4}
            pointerEvents="none"
          />
          <line
            x1={mx - 3}
            y1={my + 3}
            x2={mx + 3}
            y2={my - 3}
            stroke={stroke}
            strokeWidth={1.4}
            pointerEvents="none"
          />
        </>
      );
    case 'ellipsis':
      return (
        <>
          {dashedL}
          <rect
            x={mx - 6}
            y={my - 4}
            width={12}
            height={8}
            rx={2}
            ry={2}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <text
            x={mx}
            y={my + 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fill={text}
            pointerEvents="none"
          >
            …
          </text>
        </>
      );
    case 'ghost':
      // Faint hollow rounded square with low opacity.
      return (
        <g opacity={0.45}>
          {dashedL}
          <rect
            x={mx - 4}
            y={my - 4}
            width={8}
            height={8}
            rx={2}
            ry={2}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </g>
      );
    case 'minitree':
      // 3-prong tree silhouette: a vertical stem with three horizontal
      // prongs branching off, all in a ~10x10 box.
      return (
        <>
          {dashedL}
          <g pointerEvents="none">
            <line x1={mx - 3} y1={my} x2={mx + 1} y2={my} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my - 4} x2={mx + 1} y2={my + 4} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my - 4} x2={mx + 4} y2={my - 4} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my} x2={mx + 4} y2={my} stroke={stroke} strokeWidth={1} />
            <line x1={mx + 1} y1={my + 4} x2={mx + 4} y2={my + 4} stroke={stroke} strokeWidth={1} />
          </g>
        </>
      );
    case 'count': {
      // Auto-width pill that scales to the digit count; centered on markX.
      const label = String(stub.leafCount);
      const charW = 5;
      const w = Math.max(12, label.length * charW + 6);
      return (
        <>
          {dashedL}
          <rect
            x={mx - w / 2}
            y={my - 5}
            width={w}
            height={10}
            rx={5}
            ry={5}
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          <text
            x={mx}
            y={my + 0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={8}
            fontFamily="ui-monospace, monospace"
            fontWeight={600}
            fill={text}
            pointerEvents="none"
          >
            {label}
          </text>
        </>
      );
    }
    case 'broken': {
      // Solid stub that ends in a small jagged "break" (zigzag) — no
      // terminal glyph, conveys "branch continues but is interrupted".
      const x0 = stub.markX - 6;
      const x1 = stub.markX;
      return (
        <>
          {/* L-bend, drawn solid up to the break start. */}
          <path
            d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${x0} ${stub.stubY}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
          {/* Zigzag spans (x0..x1) at stubY. */}
          <polyline
            points={`${x0},${stub.stubY} ${x0 + 1.5},${stub.stubY - 3} ${x0 + 3},${stub.stubY + 3} ${x0 + 4.5},${stub.stubY - 3} ${x1},${stub.stubY + 1}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1}
            pointerEvents="none"
          />
        </>
      );
    }
    case 'bracket':
      // Solid L-bend ending in a small right bracket "]".
      return (
        <>
          {solidL}
          <polyline
            points={`${mx - 1},${my - 4} ${mx + 3},${my - 4} ${mx + 3},${my + 4} ${mx - 1},${my + 4}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.2}
            pointerEvents="none"
          />
        </>
      );
  }
}

export const treeZone: ZoneDefinition<TreeZoneState> = {
  id: 'tree',
  displayName: 'Tree',
  Header: TreeHeader,
  Body: TreeBody,
  defaultWidth: 30,
  minWidth: 120,
  defaultZoneState: { prunedNodeStyle: DEFAULT_PRUNED_STYLE },
  isAvailable: (data) => Boolean(data.tree),
};
