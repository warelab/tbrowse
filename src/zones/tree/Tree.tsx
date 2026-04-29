import { useMemo, useRef } from 'react';
import { ancestorIdsOf, buildChildrenIndex, countLeavesInSubtree } from '../../treeIndex';
import type { NodeId, ZoneDefinition, ZoneRenderProps } from '../../types';
import { computeTreeLayout, type TreeLayoutNode } from './layout';
import { Tooltip } from './Tooltip';

const LEFT_PAD = 6;
const RIGHT_PAD = 6;

const BRANCH_COLOR = '#444';
const BRANCH_WIDTH = 1;
const HIGHLIGHT_COLOR = '#2878dc';
const HIGHLIGHT_WIDTH = 2;
const EXTENSION_COLOR = '#bbb';
const EXTENSION_HIGHLIGHT_COLOR = '#2878dc';
const SELECT_COLOR = '#f59e0b';
const HIT_STROKE_WIDTH = 10;

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
  width,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  collapsedNodeIds,
  prunedNodeIds,
  onHoverNode,
  onSelectNode,
  onClearSelection,
  onToggleCollapsed,
  onTogglePruned,
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

      const fullChildren = fullChildrenIndex.get(anchorId) ?? [];
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
  }, [prunedNodeIds, data.tree, byId, fullChildrenIndex]);

  const isHighlighted = (nodeId: NodeId): boolean =>
    hoveredSubtreeIds.has(nodeId) || ancestorsHighlight.has(nodeId);

  if (layout.nodes.length === 0) return null;

  const totalHeight =
    visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
      : 0;

  const extensionEndX = width - 1;

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
        {/* Visible branches. */}
        <g pointerEvents="none">
          {layout.nodes.map((child) => {
            if (child.parentId === null) return null;
            const parent = byId.get(child.parentId);
            if (!parent) return null;
            const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${child.x} ${child.y}`;
            const hl = isHighlighted(child.nodeId);
            return (
              <path
                key={`b-${child.nodeId}`}
                d={d}
                stroke={hl ? HIGHLIGHT_COLOR : BRANCH_COLOR}
                strokeWidth={hl ? HIGHLIGHT_WIDTH : BRANCH_WIDTH}
                fill="none"
              />
            );
          })}
        </g>
        {/* Leaf extensions. */}
        <g pointerEvents="none">
          {layout.nodes.map((n) => {
            if (!n.isVisibleEnd) return null;
            if (n.x >= extensionEndX) return null;
            const hl = isHighlighted(n.nodeId);
            return (
              <line
                key={`e-${n.nodeId}`}
                x1={n.x}
                y1={n.y}
                x2={extensionEndX}
                y2={n.y}
                stroke={hl ? EXTENSION_HIGHLIGHT_COLOR : EXTENSION_COLOR}
                strokeWidth={hl ? 1.5 : 1}
                strokeDasharray="2 3"
              />
            );
          })}
        </g>
        {/* Selection marker. */}
        {selectedLayoutNode && (
          <circle
            cx={selectedLayoutNode.x}
            cy={selectedLayoutNode.y}
            r={4}
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
          subtreeLeafCount={selectedSubtreeLeafCount}
          onClose={onClearSelection}
          onToggleCollapsed={onToggleCollapsed}
          onTogglePruned={onTogglePruned}
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
