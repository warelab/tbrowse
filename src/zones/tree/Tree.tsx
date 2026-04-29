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

  // Pruned-node stub glyphs: one per pruned id, anchored at the closest
  // visible ancestor. Each stub is a tiny L-shaped dashed branch (vertical
  // then horizontal) ending in an open-square mark. Multiple stubs sharing
  // an anchor fan out alternately above and below.
  const prunedStubs = useMemo(() => {
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
      anchorId: NodeId;
      anchorX: number;
      anchorY: number;
      verticalY: number; // y of the bend
      horizontalX: number; // x of the mark
      markX: number;
      markY: number;
    };
    const stubs: Stub[] = [];
    for (const [anchorId, ids] of byAnchor) {
      const anchor = byId.get(anchorId);
      if (!anchor) continue;
      ids.forEach((prunedId, i) => {
        // i = 0 → down; i = 1 → up; i = 2 → down further; ...
        const slot = Math.ceil((i + 1) / 2);
        const dir = i % 2 === 0 ? 1 : -1;
        const verticalLen = 5 + (slot - 1) * 8;
        const horizontalLen = 12;
        const verticalY = anchor.y + dir * verticalLen;
        const horizontalX = anchor.x + horizontalLen;
        stubs.push({
          prunedId,
          anchorId,
          anchorX: anchor.x,
          anchorY: anchor.y,
          verticalY,
          horizontalX,
          markX: horizontalX,
          markY: verticalY,
        });
      });
    }
    return stubs;
  }, [prunedNodeIds, data.tree, byId]);

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
            One glyph per pruned id, drawn as a dashed L-branch ending in a
            small open-square mark — visually conveys "branch pruned here".
            Click → select the pruned node so the tooltip opens with a
            Regrow button. */}
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
                {/* Tiny dashed L-branch: vertical from anchor to bend,
                    then horizontal to the mark. */}
                <path
                  d={`M ${stub.anchorX} ${stub.anchorY} L ${stub.anchorX} ${stub.verticalY} L ${stub.horizontalX} ${stub.verticalY}`}
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
