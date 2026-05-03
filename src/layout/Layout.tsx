import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
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
  SearchState,
  VisibleRow,
  ZoneDefinition,
  ZoneRenderProps,
} from '../types';
import { BUILTIN_SEARCH_FIELDS, type SearchField } from '../search/fields';
import { resolveMatches } from '../search/resolveMatches';
import { ReorderHandle } from './ReorderHandle';
import { ResizeHandle } from './ResizeHandle';
import { Toolbar } from './Toolbar';
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
  /** Host-supplied search fields appended to the built-in set. */
  searchFields?: SearchField[];
  /** Hotkey opt-out forwarded from `TBrowseProps.hotkeys`. */
  hotkeys?: { search?: boolean };
  /** Ref to the chassis-root DOM element — Toolbar uses it to scope
   *  global hotkey listeners (`/`, Cmd/Ctrl-F) so they only fire
   *  when the user is interacting with our chassis. */
  containerRef: RefObject<HTMLDivElement | null>;
}

export function Layout({
  data,
  zones,
  searchFields: hostSearchFields,
  hotkeys,
  containerRef,
}: LayoutProps) {
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
  const compressedNodeIds = useMemo(
    () => new Set(viewState.compressedNodeIds ?? []),
    [viewState.compressedNodeIds],
  );

  // Search field registry: built-ins first, host extras appended so a
  // host can shadow a built-in id by re-using it (last wins) — useful
  // for swapping out the gene-id matcher with a fuzzy variant.
  const searchFields = useMemo<ReadonlyArray<SearchField>>(() => {
    if (!hostSearchFields || hostSearchFields.length === 0) {
      return BUILTIN_SEARCH_FIELDS;
    }
    const seen = new Set<string>();
    const merged: SearchField[] = [];
    for (const f of hostSearchFields) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      merged.push(f);
    }
    for (const f of BUILTIN_SEARCH_FIELDS) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      merged.push(f);
    }
    return merged;
  }, [hostSearchFields]);

  // Match resolution. Keyed on the search slice, the field registry,
  // and the data slices the built-in fields actually read; the
  // pruned-set is included so hidden leaves don't surface as matches.
  const searchResults = useMemo(
    () =>
      resolveMatches(
        data,
        viewState.search,
        searchFields,
        prunedNodeIds,
      ),
    [
      data,
      viewState.search,
      searchFields,
      prunedNodeIds,
    ],
  );

  // setSearchState replaces the search slice entirely (or clears it
  // by passing null). Wired into the chassis Toolbar's search panel
  // and exposed through ZoneRenderProps so a zone can offer
  // "search for this value" affordances on right-click etc.
  // Drops the slice back to null only when EVERYTHING is default —
  // empty query AND no excluded fields AND both modifiers off — so
  // pre-configured field selections and modifier toggles survive
  // an empty query (the user might be about to type).
  const setSearchState = useCallback(
    (next: SearchState | null) =>
      setViewState((vs) => {
        const isEmpty =
          next === null ||
          (!next.query &&
            !next.caseSensitive &&
            !next.regex &&
            (!next.excludedFields || next.excludedFields.length === 0));
        if (isEmpty) {
          return vs.search === null ? vs : { ...vs, search: null };
        }
        return { ...vs, search: next };
      }),
    [setViewState],
  );

  // "Show matches only" — collapse every internal node that isn't
  // on a path from the root to a matched leaf. The matched-ancestor
  // closure (which the search resolver already computes for triangle
  // badges) is the inverse of the set we want to collapse. No-op
  // when there are no matches; pruned and swapped state are left
  // alone so the user's other manual choices survive.
  const onCollapseToMatches = useCallback(() => {
    if (searchResults.matchedLeafIds.size === 0) return;
    setViewState((vs) => {
      const keep = new Set<NodeId>(searchResults.matchedAncestorIds);
      for (const id of searchResults.matchedLeafIds) keep.add(id);
      const next: NodeId[] = [];
      for (const id of Object.keys(data.tree.nodes)) {
        if (keep.has(id)) continue;
        const node = data.tree.nodes[id];
        if (!node || node.isLeaf) continue;
        next.push(id);
      }
      // Skip the update if the collapsed set is already exactly
      // what we want (avoids a no-op render churn when the button
      // is clicked twice with the same result).
      if (
        next.length === vs.collapsedNodeIds.length &&
        next.every((id, i) => vs.collapsedNodeIds[i] === id)
      ) {
        return vs;
      }
      return { ...vs, collapsedNodeIds: next };
    });
  }, [setViewState, data.tree, searchResults]);

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
  const [viewportWidth, setViewportWidth] = useState(0);

  // Per-zone horizontal scroll position (transient, not in viewState).
  const [scrollLefts, setScrollLefts] = useState<Record<string, number>>({});

  // Reorder drag state (transient).
  const [dragState, setDragState] = useState<DragState | null>(null);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setViewportHeight(r.height);
      setViewportWidth(r.width);
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

  const onToggleCompressed = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const cur = vs.compressedNodeIds ?? [];
        const idx = cur.indexOf(id);
        return idx >= 0
          ? { ...vs, compressedNodeIds: cur.filter((x) => x !== id) }
          : { ...vs, compressedNodeIds: [...cur, id] };
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

  const onReroot = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        // Build the path from id up to the root.
        const path = new Set<NodeId>();
        let cur: NodeId | null = id;
        while (cur !== null) {
          path.add(cur);
          cur = data.tree.nodes[cur]?.parentId ?? null;
        }
        // Path of length 1 means id IS the root — nothing to prune.
        if (path.size <= 1) return vs;
        // Walk ANCESTORS of id (parent, grandparent, ..., root) and at
        // each level prune the children that aren't on the path toward
        // id. Skip id itself — its descendants must remain visible.
        const pruned = new Set(vs.prunedNodeIds);
        for (const ancestorId of path) {
          if (ancestorId === id) continue;
          const kids = childrenIndex.get(ancestorId);
          if (!kids) continue;
          for (const k of kids) {
            if (!path.has(k)) pruned.add(k);
          }
        }
        // Make sure no path-node is collapsed; otherwise the rerooted
        // lineage would be invisible inside its own collapse.
        const collapsedNext = vs.collapsedNodeIds.filter((cid) => !path.has(cid));
        return {
          ...vs,
          prunedNodeIds: [...pruned],
          collapsedNodeIds: collapsedNext,
        };
      }),
    [setViewState, data.tree, childrenIndex],
  );

  const onRegrowOthers = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const path = new Set<NodeId>();
        let cur: NodeId | null = id;
        while (cur !== null) {
          path.add(cur);
          cur = data.tree.nodes[cur]?.parentId ?? null;
        }
        if (path.size <= 1) return vs;
        // Top-level sibling-branch ids that Prune-others would have added.
        const siblingTops = new Set<NodeId>();
        for (const ancestorId of path) {
          if (ancestorId === id) continue;
          const kids = childrenIndex.get(ancestorId);
          if (!kids) continue;
          for (const k of kids) {
            if (!path.has(k)) siblingTops.add(k);
          }
        }
        const next = vs.prunedNodeIds.filter((p) => !siblingTops.has(p));
        if (next.length === vs.prunedNodeIds.length) return vs;
        return { ...vs, prunedNodeIds: next };
      }),
    [setViewState, data.tree, childrenIndex],
  );

  const onShowParalogs = useCallback(
    (id: NodeId) =>
      setViewState((vs) => {
        const target = data.tree.nodes[id];
        if (!target || target.taxonomyId === undefined) return vs;

        // Collect the union of root-paths from every paralog leaf
        // (every leaf sharing the target's taxonomyId, target
        // included). Anything in this set is on the path to a
        // paralog and must be visible.
        const paralogPaths = new Set<NodeId>();
        for (const node of Object.values(data.tree.nodes)) {
          if (!node.isLeaf || node.taxonomyId !== target.taxonomyId) continue;
          let cur: NodeId | null = node.id;
          while (cur !== null) {
            if (paralogPaths.has(cur)) break;
            paralogPaths.add(cur);
            cur = data.tree.nodes[cur]?.parentId ?? null;
          }
        }
        if (paralogPaths.size === 0) return vs;

        const collapsedSet = new Set(vs.collapsedNodeIds);
        let changed = false;

        // Walk each path-node. If it's currently collapsed,
        // uncollapse it AND collapse every internal-node child that
        // is NOT itself on a paralog path — so revealing this
        // ancestor doesn't expose unrelated subtrees. If it's
        // already uncollapsed, leave its children alone (whatever
        // visibility state they're in is intentional).
        for (const ancestorId of paralogPaths) {
          const ancestor = data.tree.nodes[ancestorId];
          if (!ancestor || ancestor.isLeaf) continue;
          if (!collapsedSet.has(ancestorId)) continue;

          collapsedSet.delete(ancestorId);
          changed = true;

          const kids = childrenIndex.get(ancestorId);
          if (!kids) continue;
          for (const k of kids) {
            if (paralogPaths.has(k)) continue;
            const kidNode = data.tree.nodes[k];
            if (!kidNode || kidNode.isLeaf) continue;
            if (!collapsedSet.has(k)) {
              collapsedSet.add(k);
              changed = true;
            }
          }
        }

        return changed
          ? { ...vs, collapsedNodeIds: [...collapsedSet] }
          : vs;
      }),
    [setViewState, data.tree, childrenIndex],
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

  // Fill the container: zone widths act as fr-shares of the viewport.
  // Each column is `minmax(<minWidth>px, <fr>fr)` so the grid can't shrink
  // a zone below its declared minWidth (would force horizontal overflow).
  const sumZoneFr = visibleZones.reduce((sum, z) => sum + z.width, 0);
  const gridTemplateColumns = visibleZones
    .map((z) => {
      const def = zoneById.get(z.id);
      const minPx = def?.minWidth ?? 50;
      return `minmax(${minPx}px, ${z.width}fr)`;
    })
    .join(' ');

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
      compressedNodeIds,
      searchState: viewState.search,
      searchResults,
      onHoverNode,
      onSelectNode,
      onClearSelection,
      onToggleCollapsed,
      onTogglePruned,
      onToggleSwapped,
      onToggleCompressed,
      onExpandSubtree,
      onMakeNodeOfInterest,
      onShowParalogs,
      onReroot,
      onRegrowOthers,
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
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <Toolbar
        zones={zones}
        data={data}
        search={viewState.search}
        setSearch={setSearchState}
        searchResults={searchResults}
        searchFields={searchFields}
        onCollapseToMatches={onCollapseToMatches}
        hotkeys={hotkeys}
        containerRef={containerRef}
      />
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
          position: 'relative',
          cursor: dragState ? 'grabbing' : undefined,
        }}
      >
        {visibleZones.map((zoneVS, vIdx) => {
          const def = zoneById.get(zoneVS.id)!;
          // Compute the rendered pixel width from the fr-share so zone
          // bodies (which still measure in pixels for canvas sizing etc.)
          // get the right number rather than the raw fr value.
          const renderedWidth =
            sumZoneFr > 0 && viewportWidth > 0
              ? (zoneVS.width / sumZoneFr) * viewportWidth
              : zoneVS.width;
          const props = renderProps(zoneVS.id, renderedWidth, def);
          const isDragging = dragState?.zoneId === zoneVS.id;
          const nextZoneVS = visibleZones[vIdx + 1];
          const nextMinWidth = nextZoneVS
            ? (zoneById.get(nextZoneVS.id)?.minWidth ?? 50)
            : 0;
          return (
            <div
              key={`h-${zoneVS.id}`}
              className="tbrowse-zone-header"
              style={{
                position: 'sticky',
                top: 0,
                height: HEADER_HEIGHT,
                background: 'var(--tbrowse-bg-alt)',
                borderBottom: '1px solid var(--tbrowse-divider)',
                borderRight: '1px solid var(--tbrowse-border-soft)',
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
              {nextZoneVS && (
                <ResizeHandle
                  zoneId={zoneVS.id}
                  nextZoneId={nextZoneVS.id}
                  currentFr={zoneVS.width}
                  nextFr={nextZoneVS.width}
                  sumFr={sumZoneFr}
                  containerWidth={viewportWidth}
                  minWidth={def.minWidth}
                  nextMinWidth={nextMinWidth}
                />
              )}
            </div>
          );
        })}
        {visibleZones.map((zoneVS) => {
          const def = zoneById.get(zoneVS.id)!;
          const renderedWidth =
            sumZoneFr > 0 && viewportWidth > 0
              ? (zoneVS.width / sumZoneFr) * viewportWidth
              : zoneVS.width;
          const props = renderProps(zoneVS.id, renderedWidth, def);
          return (
            <div
              key={`b-${zoneVS.id}`}
              className="tbrowse-zone-body"
              style={{
                position: 'relative',
                borderRight: '1px solid var(--tbrowse-border-soft)',
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
        background: 'var(--tbrowse-accent)',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
}
