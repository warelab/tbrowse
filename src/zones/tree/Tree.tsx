import { useMemo } from 'react';
import type { ZoneDefinition, ZoneRenderProps } from '../../types';
import { computeTreeLayout, type TreeLayoutNode } from './layout';

const LEFT_PAD = 6;
const RIGHT_PAD = 6;
const BRANCH_COLOR = '#444';
const BRANCH_WIDTH = 1;
const EXTENSION_COLOR = '#bbb';

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
}: ZoneRenderProps<TreeZoneState>) => {
  const drawingWidth = Math.max(0, width - LEFT_PAD - RIGHT_PAD);

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

  if (layout.nodes.length === 0) return null;

  const totalHeight =
    visibleRows.length > 0
      ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
      : 0;

  const byId = new Map<string, TreeLayoutNode>();
  for (const n of layout.nodes) byId.set(n.nodeId, n);

  const extensionEndX = width - 1;

  return (
    <svg
      width={width}
      height={totalHeight}
      style={{ display: 'block', shapeRendering: 'crispEdges' }}
    >
      {/* Branches: L-shaped path from parent to child. */}
      <g>
        {layout.nodes.map((child) => {
          if (child.parentId === null) return null;
          const parent = byId.get(child.parentId);
          if (!parent) return null;
          const d = `M ${parent.x} ${parent.y} L ${parent.x} ${child.y} L ${child.x} ${child.y}`;
          return (
            <path
              key={`b-${child.nodeId}`}
              d={d}
              stroke={BRANCH_COLOR}
              strokeWidth={BRANCH_WIDTH}
              fill="none"
            />
          );
        })}
      </g>
      {/* Leaf extensions from each visible end to the right edge. */}
      <g>
        {layout.nodes.map((n) => {
          if (!n.isVisibleEnd) return null;
          if (n.x >= extensionEndX) return null;
          return (
            <line
              key={`e-${n.nodeId}`}
              x1={n.x}
              y1={n.y}
              x2={extensionEndX}
              y2={n.y}
              stroke={EXTENSION_COLOR}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          );
        })}
      </g>
    </svg>
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
