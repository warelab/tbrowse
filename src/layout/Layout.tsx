import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTBrowseStore } from '../store';
import { buildChildrenIndex, EMPTY_NODE_ID_SET, subtreeIdsOf } from '../treeIndex';
import { computeVisibleRows } from '../visibleRows';
import type { HostData, NodeId, ZoneDefinition, ZoneRenderProps } from '../types';
import { ChromeStrip } from './ChromeStrip';
import { ReorderHandle } from './ReorderHandle';
import { ResizeHandle } from './ResizeHandle';
import { computeRowRange } from './rowRange';

export const HEADER_HEIGHT = 40;

interface LayoutProps {
  data: HostData;
  zones: ZoneDefinition[];
}

interface DragState {
  zoneId: string;
  fromIndex: number;
  targetIndex: number;
  cursorX: number;
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

  const collapsedNodeIds = useMemo(
    () => new Set(viewState.collapsedNodeIds),
    [viewState.collapsedNodeIds],
  );
  const prunedNodeIds = useMemo(
    () => new Set(viewState.prunedNodeIds),
    [viewState.prunedNodeIds],
  );

  const visibleRows = useMemo(
    () =>
      computeVisibleRows({
        tree: data.tree,
        collapsedNodeIds,
        prunedNodeIds,
      }),
    [data.tree, collapsedNodeIds, prunedNodeIds],
  );

  const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);

  const hoveredSubtreeIds = useMemo<ReadonlySet<NodeId>>(() => {
    if (hoveredNodeId === null) return EMPTY_NODE_ID_SET;
    return subtreeIdsOf(hoveredNodeId, childrenIndex);
  }, [hoveredNodeId, childrenIndex]);

  const totalContentHeight = useMemo(
    () => visibleRows.reduce((h, r) => h + r.height, 0),
    [visibleRows],
  );

  const outerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Per-zone horizontal scroll position (transient, not in viewState).
  const [scrollLefts, setScrollLefts] = useState<Record<string, number>>({});

  // Reorder drag state (transient).
  const [dragState, setDragState] = useState<DragState | null>(null);

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

  const onClearSelection = useCallback(
    () => setViewState((vs) => (vs.selectedNodeId === null ? vs : { ...vs, selectedNodeId: null })),
    [setViewState],
  );

  const onHoverNode = useCallback(
    (id: NodeId | null) => setHoveredNodeId(id),
    [setHoveredNodeId],
  );

  const onToggleCollapsed = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const idx = vs.collapsedNodeIds.indexOf(id);
        return idx >= 0
          ? { ...vs, collapsedNodeIds: vs.collapsedNodeIds.filter((x) => x !== id) }
          : { ...vs, collapsedNodeIds: [...vs.collapsedNodeIds, id] };
      }),
    [setViewState],
  );

  const onTogglePruned = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const idx = vs.prunedNodeIds.indexOf(id);
        if (idx >= 0) {
          return { ...vs, prunedNodeIds: vs.prunedNodeIds.filter((x) => x !== id) };
        }
        // Pruning the selected node hides it from the tree, so clear selection
        // to avoid leaving an orphaned tooltip / selection marker.
        return {
          ...vs,
          prunedNodeIds: [...vs.prunedNodeIds, id],
          selectedNodeId: vs.selectedNodeId === id ? null : vs.selectedNodeId,
        };
      }),
    [setViewState],
  );

  const setZoneState = useCallback(
    (zoneId: string, fallback: unknown, next: unknown | ((prev: unknown) => unknown)) => {
      setViewState((vs) => {
        const prev = vs.zoneStates[zoneId] !== undefined ? vs.zoneStates[zoneId] : fallback;
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

  const setBodyScrollLeft = useCallback(
    (zoneId: string, next: number | ((prev: number) => number)) => {
      setScrollLefts((prev) => {
        const cur = prev[zoneId] ?? 0;
        const resolved = typeof next === 'function' ? next(cur) : next;
        if (resolved === cur) return prev;
        return { ...prev, [zoneId]: resolved };
      });
    },
    [],
  );

  const gridTemplateColumns = visibleZones.map((z) => `${z.width}px`).join(' ');

  const renderProps = (zoneId: string, width: number, def: ZoneDefinition): ZoneRenderProps => {
    const stored = viewState.zoneStates[zoneId];
    return {
      visibleRows,
      rowRange,
      hoveredNodeId,
      hoveredSubtreeIds,
      selectedNodeId: viewState.selectedNodeId,
      collapsedNodeIds,
      prunedNodeIds,
      onHoverNode,
      onSelectNode,
      onClearSelection,
      onToggleCollapsed,
      onTogglePruned,
      zoneState: stored === undefined ? def.defaultZoneState : stored,
      setZoneState: (next) => setZoneState(zoneId, def.defaultZoneState, next as unknown),
      width,
      bodyHeight: viewportHeight,
      bodyScrollLeft: scrollLefts[zoneId] ?? 0,
      setBodyScrollLeft: (next) => setBodyScrollLeft(zoneId, next),
      data,
    };
  };

  // x-position of the insertion indicator while dragging
  const indicatorX = useMemo(() => {
    if (!dragState) return null;
    let x = 0;
    for (let i = 0; i < dragState.targetIndex && i < visibleZones.length; i++) {
      x += visibleZones[i].width;
    }
    return x;
  }, [dragState, visibleZones]);

  return (
    <div
      className="tbrowse-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'white',
      }}
    >
      <ChromeStrip zones={zones} data={data} />
      <div
        ref={outerRef}
        className="tbrowse-outer"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}
      >
      <div
        ref={gridRef}
        className="tbrowse-grid"
        style={{
          display: 'grid',
          gridTemplateRows: `${HEADER_HEIGHT}px auto`,
          gridTemplateColumns: gridTemplateColumns || '1fr',
          height: HEADER_HEIGHT + totalContentHeight,
          minWidth: 'min-content',
          position: 'relative',
          cursor: dragState ? 'grabbing' : undefined,
        }}
      >
        {visibleZones.map((zoneVS) => {
          const def = zoneById.get(zoneVS.id)!;
          const props = renderProps(zoneVS.id, zoneVS.width, def);
          const isDragging = dragState?.zoneId === zoneVS.id;
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
                display: 'flex',
                alignItems: 'stretch',
                opacity: isDragging ? 0.5 : 1,
              }}
            >
              <ReorderHandle
                zoneId={zoneVS.id}
                visibleZones={visibleZones}
                gridRef={gridRef}
                setDragState={setDragState}
              />
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                <def.Header {...props} />
              </div>
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
        {indicatorX !== null && (
          <div
            className="tbrowse-reorder-indicator"
            style={{
              position: 'absolute',
              top: 0,
              left: indicatorX - 1,
              width: 2,
              height: '100%',
              background: '#2878dc',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        )}
      </div>
      </div>
    </div>
  );
}
