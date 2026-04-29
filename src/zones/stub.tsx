import type { ZoneDefinition, ZoneRenderProps } from '../types';

export interface StubZoneOptions {
  id: string;
  displayName: string;
  defaultWidth?: number;
  minWidth?: number;
  background?: string;
}

export function createStubZone(opts: StubZoneOptions): ZoneDefinition<Record<string, never>> {
  const Header = ({ width }: ZoneRenderProps<Record<string, never>>) => (
    <div
      style={{
        padding: '0 10px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        fontSize: 13,
        fontWeight: 600,
        color: '#333',
      }}
    >
      {opts.displayName}
      <span style={{ marginLeft: 8, fontWeight: 400, color: '#888' }}>{width}px</span>
    </div>
  );

  const Body = ({
    visibleRows,
    rowRange,
    hoveredNodeId,
    selectedNodeId,
    onHoverNode,
    onSelectNode,
  }: ZoneRenderProps<Record<string, never>>) => {
    const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);
    return (
      <>
        {rows.map((r) => {
          const isHovered = hoveredNodeId === r.nodeId;
          const isSelected = selectedNodeId === r.nodeId;
          return (
            <div
              key={r.nodeId}
              onMouseEnter={() => onHoverNode(r.nodeId)}
              onMouseLeave={() => onHoverNode(null)}
              onClick={() => onSelectNode(r.nodeId)}
              style={{
                position: 'absolute',
                top: r.y,
                left: 0,
                right: 0,
                height: r.height,
                fontSize: 12,
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                background: isSelected
                  ? 'rgba(40, 120, 220, 0.15)'
                  : isHovered
                    ? 'rgba(0, 0, 0, 0.04)'
                    : opts.background ?? 'transparent',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {r.kind === 'leaf' ? r.nodeId : `${r.nodeId} (collapsed, ${r.leafCount} leaves)`}
            </div>
          );
        })}
      </>
    );
  };

  return {
    id: opts.id,
    displayName: opts.displayName,
    Header,
    Body,
    defaultWidth: opts.defaultWidth ?? 200,
    minWidth: opts.minWidth ?? 80,
    defaultZoneState: {},
    isAvailable: () => true,
  };
}
