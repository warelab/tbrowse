import type { ZoneDefinition, ZoneRenderProps } from '../types';

export interface StubZoneOptions {
  id: string;
  displayName: string;
  defaultWidth?: number;
  minWidth?: number;
  /** If set, body content has this width (px) and is horizontally pannable via wheel. */
  contentWidth?: number;
}

export function createStubZone(opts: StubZoneOptions): ZoneDefinition<Record<string, never>> {
  const contentWidth = opts.contentWidth;

  const Header = ({ width, bodyScrollLeft }: ZoneRenderProps<Record<string, never>>) => (
    <div
      style={{
        padding: '0 10px 0 18px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: '#333',
        position: 'relative',
      }}
    >
      <span style={{ fontWeight: 600 }}>{opts.displayName}</span>
      <span style={{ fontWeight: 400, color: '#888' }}>{width}px</span>
      {contentWidth !== undefined && (
        <ViewportIndicator
          contentWidth={contentWidth}
          width={width}
          bodyScrollLeft={bodyScrollLeft}
        />
      )}
    </div>
  );

  const Body = ({
    visibleRows,
    rowRange,
    hoveredNodeId,
    hoveredSubtreeIds,
    selectedNodeId,
    onHoverNode,
    onSelectNode,
    width,
    bodyScrollLeft,
    setBodyScrollLeft,
  }: ZoneRenderProps<Record<string, never>>) => {
    const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);
    const maxScroll = contentWidth !== undefined ? Math.max(0, contentWidth - width) : 0;

    const onWheel = (e: React.WheelEvent) => {
      if (contentWidth === undefined) return;
      if (e.deltaX === 0) return;
      e.preventDefault();
      setBodyScrollLeft((prev) => Math.max(0, Math.min(maxScroll, prev + e.deltaX)));
    };

    const innerStyle: React.CSSProperties = {
      position: 'relative',
      height: '100%',
      width: contentWidth ?? '100%',
      transform: contentWidth !== undefined ? `translateX(${-bodyScrollLeft}px)` : undefined,
    };

    return (
      <div onWheel={onWheel} style={{ height: '100%', position: 'relative' }}>
        <div style={innerStyle}>
          {rows.map((r) => {
            const isExactHover = hoveredNodeId === r.nodeId;
            const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
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
                  width: contentWidth ?? '100%',
                  height: r.height,
                  fontSize: 12,
                  padding: '0 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  background: isSelected
                    ? 'rgba(40, 120, 220, 0.15)'
                    : isExactHover
                      ? 'rgba(40, 120, 220, 0.08)'
                      : isInHoveredSubtree
                        ? 'rgba(40, 120, 220, 0.04)'
                        : 'transparent',
                  fontWeight: isInHoveredSubtree ? 600 : 400,
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  opacity: r.opacity ?? 1,
                  transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
                }}
              >
                <span>{r.kind === 'leaf' ? r.nodeId : `${r.nodeId} (collapsed, ${r.leafCount})`}</span>
                {contentWidth !== undefined && (
                  <span style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 11 }}>
                    {/* repeated content to make rows visibly wide */}
                    {Array.from({ length: 24 }, (_, i) => `col${i}`).join(' · ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
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

function ViewportIndicator({
  contentWidth,
  width,
  bodyScrollLeft,
}: {
  contentWidth: number;
  width: number;
  bodyScrollLeft: number;
}) {
  const trackWidth = 80;
  const ratio = Math.min(1, width / contentWidth);
  const indicatorWidth = Math.max(8, trackWidth * ratio);
  const maxScroll = Math.max(1, contentWidth - width);
  const offsetRatio = Math.min(1, Math.max(0, bodyScrollLeft / maxScroll));
  const left = (trackWidth - indicatorWidth) * offsetRatio;

  return (
    <div
      style={{
        marginLeft: 'auto',
        width: trackWidth,
        height: 8,
        background: '#e0e0e0',
        borderRadius: 4,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left,
          top: 0,
          width: indicatorWidth,
          height: '100%',
          background: '#2878dc',
          borderRadius: 4,
        }}
      />
    </div>
  );
}
