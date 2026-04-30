import { useMemo, useRef } from 'react';
import { ancestorIdsOf, buildChildrenIndex, countLeavesInSubtree } from '../../treeIndex';
import type { NodeId, ZoneDefinition, ZoneRenderProps } from '../../types';
import { computeTreeLayout, type TreeLayoutNode } from './layout';
import { Tooltip } from './Tooltip';

const LEFT_PAD = 6;
const RIGHT_PAD = 6;

const BRANCH_COLOR = '#444';
const BRANCH_WIDTH = 1.5;
const HIGHLIGHT_COLOR = '#2878dc';
const HIGHLIGHT_WIDTH = 2.5;
const EXTENSION_COLOR = '#bbb';
const EXTENSION_HIGHLIGHT_COLOR = '#2878dc';
const SELECT_COLOR = '#f59e0b';
const SELECT_RADIUS = 5;
const HIT_STROKE_WIDTH = 12;
const SPECIATION_COLOR = '#777';
const DUPLICATION_COLOR = '#c0392b';
const NODE_GLYPH_RADIUS = 3.5;
const NODE_GLYPH_SQUARE = 7;
// Bootstrap (0..100) maps to opacity multiplier in [BOOTSTRAP_MIN, 1].
// Lets low-confidence branches fade to ~40% without disappearing entirely.
const BOOTSTRAP_OPACITY_MIN = 0.4;
const COLLAPSED_TRIANGLE_WIDTH = 18;
const COLLAPSED_TRIANGLE_MIN_H = 8;
const COLLAPSED_TRIANGLE_MAX_H = 22;
const COLLAPSED_TRIANGLE_FILL = 'rgba(100, 110, 120, 0.20)';
const COLLAPSED_TRIANGLE_STROKE = '#666';

function collapsedTriangleHeight(leafCount: number): number {
  // Logarithmic so a 2-leaf and a 1000-leaf collapsed subtree are
  // distinguishable but both stay inside a single row's height.
  const h = 4 + Math.log2(Math.max(1, leafCount + 1)) * 4;
  return Math.max(COLLAPSED_TRIANGLE_MIN_H, Math.min(COLLAPSED_TRIANGLE_MAX_H, h));
}

type TreeZoneState = Record<string, never>;

const TreeHeader = ({ width }: ZoneRenderProps<TreeZoneState>) => (
  <div
    style={{
      padding: '0 10px',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: '#333',
    }}
  >
    <span style={{ fontWeight: 600 }}>Tree</span>
    <span style={{ fontWeight: 400, color: '#888', fontSize: 11 }}>{width}px</span>
  </div>
);

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
  nodeOfInterestId,
  onHoverNode,
  onSelectNode,
  onClearSelection,
  onToggleCollapsed,
  onTogglePruned,
  onToggleSwapped,
  onExpandSubtree,
  onMakeNodeOfInterest,
  onShowParalogs,
}: ZoneRenderProps<TreeZoneState>) => {
  const drawingWidth = Math.max(0, width - LEFT_PAD - RIGHT_PAD);
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(
    () =>
      computeTreeLayout({
        tree: data.tree,
        visibleRows,
        drawingLeftX: LEFT_PAD,
        drawingWidth,
      }),
    [data.tree, visibleRows, drawingWidth],
  );

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
    const STUB_OFFSET = 5;
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

  // For the tooltip's "Expand all" affordance: does the selected node's
  // subtree contain any currently-collapsed internal node? Only relevant
  // when the selected node itself is internal and not currently collapsed.
  const selectedHasCollapsedDescendants = useMemo(() => {
    if (selectedNodeId === null) return false;
    if (!selectedTreeNode || selectedTreeNode.isLeaf) return false;
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
  }, [selectedNodeId, selectedTreeNode, collapsedNodeIds, fullChildrenIndex]);

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
            count, capped to fit within a single row. */}
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
            return (
              <polygon
                key={`c-${n.nodeId}`}
                points={`${apexX},${n.y} ${baseX},${top} ${baseX},${bot}`}
                fill={COLLAPSED_TRIANGLE_FILL}
                stroke={COLLAPSED_TRIANGLE_STROKE}
                strokeWidth={1}
                opacity={opacity}
              >
                <title>{`Collapsed (${row.leafCount} leaves)`}</title>
              </polygon>
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
        {/* Selection marker. */}
        {selectedLayoutNode && (
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
            const stroke = isSelected ? HIGHLIGHT_COLOR : '#888';
            const markFill = isSelected ? HIGHLIGHT_COLOR : 'white';
            return (
              <g
                key={`pstub-${stub.prunedId}`}
                style={{ cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(stub.prunedId);
                }}
              >
                {/* Tiny dashed L-stub off the anchor's branch: short
                    vertical down, then horizontal in the original
                    branch's direction. */}
                <path
                  d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.stubY} L ${stub.markX} ${stub.stubY}`}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  pointerEvents="none"
                />
                {/* Open-square branch tip. */}
                <rect
                  x={stub.markX - 3}
                  y={stub.markY - 3}
                  width={6}
                  height={6}
                  fill={markFill}
                  stroke={stroke}
                  strokeWidth={1}
                  pointerEvents="none"
                />
                {/* Forgiving transparent click target. */}
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
          isNodeOfInterest={nodeOfInterestId === selectedNodeId}
          subtreeLeafCount={selectedSubtreeLeafCount}
          hasCollapsedDescendants={selectedHasCollapsedDescendants}
          onClose={onClearSelection}
          onToggleCollapsed={onToggleCollapsed}
          onTogglePruned={onTogglePruned}
          onToggleSwapped={onToggleSwapped}
          onExpandSubtree={onExpandSubtree}
          onMakeNodeOfInterest={onMakeNodeOfInterest}
          onShowParalogs={onShowParalogs}
        />
      )}
    </>
  );
};

export const treeZone: ZoneDefinition<TreeZoneState> = {
  id: 'tree',
  displayName: 'Tree',
  Header: TreeHeader,
  Body: TreeBody,
  defaultWidth: 280,
  minWidth: 120,
  defaultZoneState: {},
  isAvailable: (data) => Boolean(data.tree),
};
