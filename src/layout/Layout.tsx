import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTBrowseStore } from '../store';
import { computeVisibleRows } from '../visibleRows';
import type { HostData, NodeId, ZoneDefinition, ZoneRenderProps } from '../types';
import { ResizeHandle } from './ResizeHandle';
import { computeRowRange } from './rowRange';

export const HEADER_HEIGHT = 40;

interface LayoutProps {
  data: HostData;
  zones: ZoneDefinition[];
}

export function Layout({ data, zones }: LayoutProps) {
  const viewState = useTBrowseStore((s) => s.viewState);
  const setViewState = useTBrowseStore((s) => s.setViewState);
  const hoveredNodeId = useTBrowseStore((s) => s.hoveredNodeId);
  const setHoveredNodeId = useTBrowseStore((s) => s.setHoveredNodeId);

  const zoneById = useMemo(() => {
    const map = new Map<string, ZoneDefinition>();
    for (const z of zones) map.set(z.id, z);
    return map;
  }, [zones]);

  const visibleZones = useMemo(
    () => viewState.zones.filter((z) => z.visible && zoneById.has(z.id)),
    [viewState.zones, zoneById],
  );

  const visibleRows = useMemo(
    () =>
      computeVisibleRows({
        tree: data.tree,
        collapsedNodeIds: new Set(viewState.collapsedNodeIds),
        prunedNodeIds: new Set(viewState.prunedNodeIds),
      }),
    [data.tree, viewState.collapsedNodeIds, viewState.prunedNodeIds],
  );

  const totalContentHeight = useMemo(
    () => visibleRows.reduce((h, r) => h + r.height, 0),
    [visibleRows],
  );

  const outerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setViewportHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowRange = useMemo(
    () => computeRowRange(visibleRows, scrollTop, viewportHeight),
    [visibleRows, scrollTop, viewportHeight],
  );

  const onSelectNode = useCallback(
    (id: NodeId) => setViewState((vs) => ({ ...vs, selectedNodeId: id })),
    [setViewState],
  );

  const onHoverNode = useCallback(
    (id: NodeId | null) => setHoveredNodeId(id),
    [setHoveredNodeId],
  );

  const setZoneState = useCallback(
    (zoneId: string, next: unknown | ((prev: unknown) => unknown)) => {
      setViewState((vs) => {
        const prev = vs.zoneStates[zoneId];
        const resolved =
          typeof next === 'function' ? (next as (p: unknown) => unknown)(prev) : next;
        return {
          ...vs,
          zoneStates: { ...vs.zoneStates, [zoneId]: resolved },
        };
      });
    },
    [setViewState],
  );

  const gridTemplateColumns = visibleZones.map((z) => `${z.width}px`).join(' ');

  const renderProps = (zoneId: string, width: number, def: ZoneDefinition): ZoneRenderProps => {
    const stored = viewState.zoneStates[zoneId];
    return {
      visibleRows,
      rowRange,
      hoveredNodeId,
      selectedNodeId: viewState.selectedNodeId,
      onHoverNode,
      onSelectNode,
      zoneState: stored === undefined ? def.defaultZoneState : stored,
      setZoneState: (next) => setZoneState(zoneId, next as unknown),
      width,
      bodyHeight: viewportHeight,
      bodyScrollLeft: 0,
      data,
    };
  };

  return (
    <div
      ref={outerRef}
      className="tbrowse-outer"
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        background: 'white',
      }}
    >
      <div
        className="tbrowse-grid"
        style={{
          display: 'grid',
          gridTemplateRows: `${HEADER_HEIGHT}px auto`,
          gridTemplateColumns: gridTemplateColumns || '1fr',
          height: HEADER_HEIGHT + totalContentHeight,
          minWidth: 'min-content',
        }}
      >
        {visibleZones.map((zoneVS) => {
          const def = zoneById.get(zoneVS.id)!;
          const props = renderProps(zoneVS.id, zoneVS.width, def);
          return (
            <div
              key={`h-${zoneVS.id}`}
              className="tbrowse-zone-header"
              style={{
                position: 'sticky',
                top: 0,
                height: HEADER_HEIGHT,
                background: '#f7f7f7',
                borderBottom: '1px solid #ddd',
                borderRight: '1px solid #eee',
                zIndex: 1,
                overflow: 'hidden',
              }}
            >
              <def.Header {...props} />
              <ResizeHandle
                zoneId={zoneVS.id}
                currentWidth={zoneVS.width}
                minWidth={def.minWidth}
              />
            </div>
          );
        })}
        {visibleZones.map((zoneVS) => {
          const def = zoneById.get(zoneVS.id)!;
          const props = renderProps(zoneVS.id, zoneVS.width, def);
          return (
            <div
              key={`b-${zoneVS.id}`}
              className="tbrowse-zone-body"
              style={{
                position: 'relative',
                borderRight: '1px solid #eee',
                overflow: 'hidden',
              }}
            >
              <def.Body {...props} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

