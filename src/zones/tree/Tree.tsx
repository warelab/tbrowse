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

  const isHighlighted = (nodeId: NodeId): boolean =>
    hoveredSubtreeIds.has(nodeId) || ancestorsHighlight.has(nodeId);

  if (layout.nodes.length === 0) return null;

  const totalHeight =
    visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
      : 0;

  const byId = new Map<string, TreeLayoutNode>();
  for (const n of layout.nodes) byId.set(n.nodeId, n);

  const extensionEndX = width - 1;
  const selectedLayoutNode = selectedNodeId !== null ? byId.get(selectedNodeId) : null;
  const selectedTreeNode =
    selectedNodeId !== null ? data.tree.nodes[selectedNodeId] : null;

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
