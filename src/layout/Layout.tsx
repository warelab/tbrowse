import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTBrowseStore } from '../store';
import { computePivotState } from '../pivot';
import {
  buildChildrenIndex,
  EMPTY_NODE_ID_SET,
  subtreeIdsOf,
} from '../treeIndex';
import { computeVisibleRows } from '../visibleRows';
import type {
  HostData,
  NodeId,
  VisibleRow,
  ZoneDefinition,
  ZoneRenderProps,
} from '../types';
import { ChromeStrip } from './ChromeStrip';
import { ReorderHandle } from './ReorderHandle';
import { ResizeHandle } from './ResizeHandle';
import { computeRowRange } from './rowRange';

export const HEADER_HEIGHT = 56;
/** Top portion of the header where the reorder handle lives. Other zones can
 *  use this as padding-left for content that would otherwise sit beneath it. */
export const HEADER_HANDLE_HEIGHT = 28;
export const HEADER_HANDLE_WIDTH = 14;

interface DragState {
  zoneId: string;
  fromIndex: number;
  targetIndex: number;
  cursorX: number;
}
const ANIMATION_DURATION_MS = 260;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);

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

  const collapsedNodeIds = useMemo(
    () => new Set(viewState.collapsedNodeIds),
    [viewState.collapsedNodeIds],
  );
  const prunedNodeIds = useMemo(
    () => new Set(viewState.prunedNodeIds),
    [viewState.prunedNodeIds],
  );
  const swappedNodeIds = useMemo(
    () => new Set(viewState.swappedNodeIds ?? []),
    [viewState.swappedNodeIds],
  );

  const targetVisibleRows = useMemo(
    () =>
      computeVisibleRows({
        tree: data.tree,
        collapsedNodeIds,
        prunedNodeIds,
        swappedNodeIds,
      }),
    [data.tree, collapsedNodeIds, prunedNodeIds, swappedNodeIds],
  );

  // Animation: lerp visibleRows between the previous and target snapshots
  // whenever collapse / prune state changes. Existing rows interpolate y;
  // added rows fade in at the target y; removed rows fade out at their
  // previous y. Animation state lives in refs (with a single render-trigger
  // useState) so the rAF loop is not coupled to React's effect lifecycle.
  const animationRef = useRef<{
    previous: VisibleRow[];
    target: VisibleRow[];
    startTime: number;
  } | null>(null);
  const [animationTick, setAnimationTick] = useState(0);
  const lastRowsRef = useRef<VisibleRow[]>(targetVisibleRows);

  useEffect(() => {
    if (lastRowsRef.current === targetVisibleRows) return;
    const prev = lastRowsRef.current;
    lastRowsRef.current = targetVisibleRows;
    if (prev.length === 0 && targetVisibleRows.length === 0) return;

    animationRef.current = {
      previous: prev,
      target: targetVisibleRows,
      startTime: performance.now(),
    };
    setAnimationTick((n) => n + 1);

    const tick = () => {
      const a = animationRef.current;
      if (!a) return;
      const t = Math.min(1, (performance.now() - a.startTime) / ANIMATION_DURATION_MS);
      if (t >= 1) {
        animationRef.current = null;
        setAnimationTick((n) => n + 1);
        return;
      }
      setAnimationTick((n) => n + 1);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [targetVisibleRows]);

  const visibleRows = useMemo<VisibleRow[]>(() => {
    const a = animationRef.current;
    if (!a) return targetVisibleRows;
    const t = Math.min(1, (performance.now() - a.startTime) / ANIMATION_DURATION_MS);
    if (t >= 1) return targetVisibleRows;
    const eased = easeOut(t);
    const targetById = new Map(a.target.map((r) => [r.nodeId, r]));
    const previousById = new Map(a.previous.map((r) => [r.nodeId, r]));

    const merged: VisibleRow[] = [];
    for (const target of a.target) {
      const prev = previousById.get(target.nodeId);
      if (prev) {
        merged.push({
          ...target,
          y: prev.y + (target.y - prev.y) * eased,
          opacity: 1,
        });
      } else {
        merged.push({ ...target, opacity: eased });
      }
    }
    for (const prev of a.previous) {
      if (!targetById.has(prev.nodeId)) {
        merged.push({ ...prev, opacity: 1 - eased });
      }
    }
    merged.sort((a, b) => a.y - b.y);
    return merged;
    // animationTick is the render-trigger; including it makes the memo
    // re-run on every rAF tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetVisibleRows, animationTick]);

  const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);

  const hoveredSubtreeIds = useMemo<ReadonlySet<NodeId>>(() => {
    if (hoveredNodeId === null) return EMPTY_NODE_ID_SET;
    return subtreeIdsOf(hoveredNodeId, childrenIndex);
  }, [hoveredNodeId, childrenIndex]);

  const totalContentHeight = useMemo(() => {
    let h = 0;
    for (const r of visibleRows) {
      const bottom = r.y + r.height;
      if (bottom > h) h = bottom;
    }
    return h;
  }, [visibleRows]);

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
    (id: NodeId) => {
      // The root has no parent for the rest of the tree to attach to, so
      // pruning it would empty the display. Silently ignore.
      if (id === data.tree.rootId) return;
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
      });
    },
    [setViewState, data.tree.rootId],
  );

  const onToggleSwapped = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const swapped = vs.swappedNodeIds ?? [];
        const idx = swapped.indexOf(id);
        return idx >= 0
          ? { ...vs, swappedNodeIds: swapped.filter((x) => x !== id) }
          : { ...vs, swappedNodeIds: [...swapped, id] };
      }),
    [setViewState],
  );

  const onExpandSubtree = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        if (vs.collapsedNodeIds.length === 0) return vs;
        const subtree = subtreeIdsOf(id, childrenIndex);
        const next = vs.collapsedNodeIds.filter((nodeId) => !subtree.has(nodeId));
        if (next.length === vs.collapsedNodeIds.length) return vs;
        return { ...vs, collapsedNodeIds: next };
      }),
    [setViewState, childrenIndex],
  );

  const onMakeNodeOfInterest = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const pivot = computePivotState(data.tree, id);
        if (!pivot) return vs;
        // Swap-only pivot: do not touch collapsedNodeIds.
        return {
          ...vs,
          swappedNodeIds: pivot.swappedNodeIds,
          nodeOfInterestId: pivot.targetId,
        };
      }),
    [setViewState, data.tree],
  );

  const onShowParalogs = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const target = data.tree.nodes[id];
        if (!target || target.taxonomyId === undefined) return vs;
        if (vs.collapsedNodeIds.length === 0) return vs;
        const collapsedSet = new Set(vs.collapsedNodeIds);
        let changed = false;
        for (const node of Object.values(data.tree.nodes)) {
          if (!node.isLeaf) continue;
          if (node.taxonomyId !== target.taxonomyId) continue;
          let cur = node.parentId;
          while (cur !== null) {
            if (collapsedSet.has(cur)) {
              collapsedSet.delete(cur);
              changed = true;
            }
            cur = data.tree.nodes[cur]?.parentId ?? null;
          }
        }
        return changed
          ? { ...vs, collapsedNodeIds: [...collapsedSet] }
          : vs;
      }),
    [setViewState, data.tree],
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
      swappedNodeIds,
      onHoverNode,
      onSelectNode,
      onClearSelection,
      onToggleCollapsed,
      onTogglePruned,
      onToggleSwapped,
      onExpandSubtree,
      onMakeNodeOfInterest,
      onShowParalogs,
      nodeOfInterestId: viewState.nodeOfInterestId ?? null,
      zoneState: stored === undefined ? def.defaultZoneState : stored,
      setZoneState: (next) => setZoneState(zoneId, def.defaultZoneState, next as unknown),
      width,
      bodyHeight: viewportHeight,
      bodyScrollLeft: scrollLefts[zoneId] ?? 0,
      setBodyScrollLeft: (next) => setBodyScrollLeft(zoneId, next),
      data,
    };
  };

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
              <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                <def.Header {...props} />
              </div>
              {/* Reorder handle overlaid at the top-left so it only occupies
                  the upper half of the header. Zones whose top-row content
                  reaches the left edge add a small padding-left to clear it. */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: HEADER_HANDLE_WIDTH,
                  height: HEADER_HANDLE_HEIGHT,
                  zIndex: 2,
                }}
              >
                <ReorderHandle
                  zoneId={zoneVS.id}
                  visibleZones={visibleZones}
                  gridRef={gridRef}
                  setDragState={setDragState}
                />
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
        {dragState !== null && (
          <ReorderInsertionIndicator
            visibleZones={visibleZones}
            targetIndex={dragState.targetIndex}
          />
        )}
      </div>
      </div>
    </div>
  );
}

function ReorderInsertionIndicator({
  visibleZones,
  targetIndex,
}: {
  visibleZones: { width: number }[];
  targetIndex: number;
}) {
  let x = 0;
  for (let i = 0; i < targetIndex && i < visibleZones.length; i++) {
    x += visibleZones[i].width;
  }
  return (
    <div
      className="tbrowse-reorder-indicator"
      style={{
        position: 'absolute',
        top: 0,
        left: x - 1,
        width: 2,
        height: '100%',
        background: '#2878dc',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
