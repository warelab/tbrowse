import { useCallback, useEffect, useMemo, useRef } from 'react';
import { buildChildrenIndex, subtreeIdsOf } from '../../treeIndex';
import type { GeneId, MSA, NodeId, ZoneDefinition, ZoneRenderProps } from '../../types';
import {
  applicableSchemes,
  defaultSchemeFor,
  getScheme,
  type ColorSchemeId,
} from './coloring';
import { computeMSAMask, unmaskedMSA, type MSAMask } from './mask';
import { MaskPanel } from './MaskPanel';
import { Minimap } from './Minimap';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';

export interface MSAZoneState {
  /** First visible-column (inclusive) of the viewport. */
  viewportStart: number;
  /** Last visible-column (exclusive). When <= viewportStart, treat as "full alignment". */
  viewportEnd: number;
  /** Optional. Falls back to defaultSchemeFor(alphabet) when undefined. */
  colorSchemeId?: ColorSchemeId;
  /** Mask parameters. When undefined, defaults are used. */
  mask?: {
    enabled: boolean;
    minCoverage: number;
    padding: number;
    /** Original-column start indices of mask runs the user has expanded. */
    expandedRuns?: number[];
  };
}

const DEFAULT_STATE: MSAZoneState = { viewportStart: 0, viewportEnd: 0 };
const DEFAULT_MASK = { enabled: true, minCoverage: 1, padding: 0, expandedRuns: [] };

const PAD_X = 4;
const TEXT_RENDER_MIN_PX = 7;
const RESIDUE_COLOR = '#444';
const RESIDUE_BG_COLOR = '#cfd6df';
const CONSENSUS_OPACITY = 0.7;

/** Returns the most-common non-gap residue across the given sequences at `col`, or null. */
function consensusAt(
  geneIds: readonly GeneId[],
  sequences: MSA['sequences'],
  col: number,
): string | null {
  const counts: Record<string, number> = {};
  let bestCh: string | null = null;
  let bestN = 0;
  for (const id of geneIds) {
    const ch = sequences[id]?.[col];
    if (!ch || ch === '-') continue;
    const n = (counts[ch] ?? 0) + 1;
    counts[ch] = n;
    if (n > bestN) {
      bestN = n;
      bestCh = ch;
    }
  }
  return bestCh;
}

/**
 * Walk every leaf in the tree and collect those whose sequence is in the
 * MSA AND whose ancestor chain contains no pruned node. Used both for the
 * column-mask coverage and for collapsed-summary consensus.
 */
function computeActiveGeneIds(
  tree: ZoneRenderProps['data']['tree'],
  msa: MSA,
  prunedNodeIds: ReadonlySet<NodeId>,
): Set<GeneId> {
  const set = new Set<GeneId>();
  for (const node of Object.values(tree.nodes)) {
    if (!node.isLeaf || !node.geneId) continue;
    if (!msa.sequences[node.geneId]) continue;
    let cur: NodeId | null = node.id;
    let isPruned = false;
    while (cur !== null) {
      if (prunedNodeIds.has(cur)) {
        isPruned = true;
        break;
      }
      cur = tree.nodes[cur]?.parentId ?? null;
    }
    if (!isPruned) set.add(node.geneId);
  }
  return set;
}

interface ResolvedViewport {
  start: number;
  end: number;
  /** end - start, the number of visible columns. */
  width: number;
}

function resolveViewport(state: MSAZoneState, totalCols: number): ResolvedViewport {
  if (state.viewportEnd > state.viewportStart) {
    const start = Math.max(0, state.viewportStart);
    const end = Math.min(totalCols, state.viewportEnd);
    return { start, end, width: Math.max(1, end - start) };
  }
  return { start: 0, end: totalCols, width: Math.max(1, totalCols) };
}

const MSAHeader = ({
  data,
  zoneState,
  setZoneState,
  prunedNodeIds,
  width,
}: ZoneRenderProps<MSAZoneState>) => {
  const msa = data.msa;
  const maskParams = zoneState.mask ?? DEFAULT_MASK;
  const activeGeneIds = useMemo(
    () => (msa ? computeActiveGeneIds(data.tree, msa, prunedNodeIds) : new Set<GeneId>()),
    [msa, data.tree, prunedNodeIds],
  );
  const expandedRunStarts = useMemo(
    () => new Set(maskParams.expandedRuns ?? []),
    [maskParams.expandedRuns],
  );
  const mask = useMemo<MSAMask | null>(() => {
    if (!msa) return null;
    return maskParams.enabled
      ? computeMSAMask(
          msa,
          activeGeneIds,
          maskParams.minCoverage,
          maskParams.padding,
          expandedRunStarts,
        )
      : unmaskedMSA(msa);
  }, [
    msa,
    activeGeneIds,
    maskParams.enabled,
    maskParams.minCoverage,
    maskParams.padding,
    expandedRunStarts,
  ]);
  const totalVisible = mask?.visibleCols.length ?? 0;
  const vp = msa ? resolveViewport(zoneState, totalVisible) : null;
  const headerScheme = msa ? getScheme(zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet)) : null;

  // Per-visible-column consensus residue + colour, fed to the consensus
  // track (the "root node consensus" view, scaled to span the whole header
  // so the body's viewport rectangle can be aligned against it).
  const consensus = useMemo(() => {
    if (!msa || !mask) return { residues: [] as (string | null)[], colors: [] as (string | null)[] };
    const ids = [...activeGeneIds];
    const residues = new Array<string | null>(mask.visibleCols.length);
    const colors = new Array<string | null>(mask.visibleCols.length);
    for (let i = 0; i < mask.visibleCols.length; i++) {
      const ch = consensusAt(ids, msa.sequences, mask.visibleCols[i]);
      residues[i] = ch;
      colors[i] = ch ? (headerScheme?.color(ch) ?? '#888') : null;
    }
    return { residues, colors };
  }, [msa, mask, activeGeneIds, headerScheme]);

  const setViewport = useCallback(
    (start: number, end: number) =>
      setZoneState((s) => ({ ...s, viewportStart: start, viewportEnd: end })),
    [setZoneState],
  );

  // The minimap row sits at exactly the body's residue grid extent (PAD_X
  // from each zone edge), positioned absolutely so its width is independent
  // of any flex/padding gymnastics on the surrounding header. The top control
  // row reserves room above the minimap by leaving `LEAF_ROW_HEIGHT + gap` of
  // bottom space.
  const minimapWidth = Math.max(0, width - 2 * PAD_X);
  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        fontSize: 13,
        color: '#333',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 10,
          right: 10,
          bottom: LEAF_ROW_HEIGHT + 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          paddingLeft: 8, // clear the chassis-level reorder handle in the top-left
        }}
      >
        <span style={{ fontWeight: 600 }}>MSA</span>
        {msa && vp && (
          <>
            <span style={{ fontWeight: 400, color: '#888', fontSize: 11 }}>{msa.alphabet}</span>
            <span
              style={{
                fontWeight: 400,
                color: '#888',
                fontSize: 11,
                whiteSpace: 'nowrap',
              }}
            >
              {vp.start + 1}–{vp.end} / {totalVisible}
              {mask && totalVisible < msa.length ? ` (of ${msa.length})` : ''}
            </span>
            <SchemeSelect msa={msa} zoneState={zoneState} setZoneState={setZoneState} />
            <MaskPanel
              params={maskParams}
              maxCoverage={activeGeneIds.size}
              hiddenCols={msa.length - totalVisible}
              totalCols={msa.length}
              onChange={(next) => setZoneState((s) => ({ ...s, mask: next }))}
            />
          </>
        )}
      </div>
      {msa && vp && (
        <div
          style={{
            position: 'absolute',
            left: PAD_X,
            bottom: 3,
            width: minimapWidth,
            height: LEAF_ROW_HEIGHT,
          }}
        >
          <Minimap
            colors={consensus.colors}
            totalCols={totalVisible}
            vp={vp}
            onSetViewport={setViewport}
            height={LEAF_ROW_HEIGHT}
            width={minimapWidth}
          />
        </div>
      )}
    </div>
  );
};

function SchemeSelect({
  msa,
  zoneState,
  setZoneState,
}: {
  msa: MSA;
  zoneState: MSAZoneState;
  setZoneState: ZoneRenderProps<MSAZoneState>['setZoneState'];
}) {
  const schemes = applicableSchemes(msa.alphabet);
  const selectedId = zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet);
  return (
    <select
      value={selectedId}
      onChange={(e) =>
        setZoneState((s) => ({ ...s, colorSchemeId: e.target.value as ColorSchemeId }))
      }
      style={{
        fontSize: 11,
        padding: '1px 4px',
        border: '1px solid #ccc',
        borderRadius: 3,
        background: 'white',
        color: '#333',
        cursor: 'pointer',
      }}
      title="Color scheme"
    >
      {schemes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}

const MSABody = ({
  data,
  visibleRows,
  rowRange,
  width,
  zoneState,
  setZoneState,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  prunedNodeIds,
  onHoverNode,
  onSelectNode,
}: ZoneRenderProps<MSAZoneState>) => {
  const msa = data.msa;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalHeight = useMemo(
    () =>
      visibleRows.length > 0
        ? visibleRows[visibleRows.length - 1].y + visibleRows[visibleRows.length - 1].height
        : 0,
    [visibleRows],
  );

  // Active leaves (not under any pruned ancestor) drive both the column mask
  // and consensus rendering for collapsed-summary rows.
  const activeGeneIds = useMemo(
    () => (msa ? computeActiveGeneIds(data.tree, msa, prunedNodeIds) : new Set<GeneId>()),
    [msa, data.tree, prunedNodeIds],
  );
  const maskParams = zoneState.mask ?? DEFAULT_MASK;
  const expandedRunStarts = useMemo(
    () => new Set(maskParams.expandedRuns ?? []),
    [maskParams.expandedRuns],
  );
  const mask = useMemo<MSAMask | null>(() => {
    if (!msa) return null;
    return maskParams.enabled
      ? computeMSAMask(
          msa,
          activeGeneIds,
          maskParams.minCoverage,
          maskParams.padding,
          expandedRunStarts,
        )
      : unmaskedMSA(msa);
  }, [
    msa,
    activeGeneIds,
    maskParams.enabled,
    maskParams.minCoverage,
    maskParams.padding,
    expandedRunStarts,
  ]);
  const totalVisible = mask?.visibleCols.length ?? 0;

  // Pre-compute leaf gene-id sets per collapsed-summary node, restricted to
  // the active (non-pruned) set. Cache invalidates on tree or prune change.
  const childrenIndex = useMemo(() => buildChildrenIndex(data.tree), [data.tree]);
  const leafGeneIdsByNode = useMemo(() => {
    const cache = new Map<NodeId, GeneId[]>();
    return (rootId: NodeId): GeneId[] => {
      const cached = cache.get(rootId);
      if (cached) return cached;
      const subtree = subtreeIdsOf(rootId, childrenIndex);
      const ids: GeneId[] = [];
      for (const id of subtree) {
        const node = data.tree.nodes[id];
        if (
          node?.isLeaf &&
          node.geneId &&
          msa?.sequences[node.geneId] &&
          activeGeneIds.has(node.geneId)
        ) {
          ids.push(node.geneId);
        }
      }
      cache.set(rootId, ids);
      return ids;
    };
  }, [data.tree, childrenIndex, msa, activeGeneIds]);

  // Re-paint whenever the inputs that affect the canvas change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !msa || width <= 0 || totalHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(totalHeight * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, totalHeight);

    const vp = resolveViewport(zoneState, totalVisible);
    const innerWidth = Math.max(1, width - 2 * PAD_X);
    const residueWidth = innerWidth / vp.width;
    const scheme = getScheme(zoneState.colorSchemeId ?? defaultSchemeFor(msa.alphabet));
    const visibleCols = mask ? mask.visibleCols : null;

    const renderText = residueWidth >= TEXT_RENDER_MIN_PX;
    if (renderText) {
      ctx.font = '11px ui-monospace, "SF Mono", Menlo, monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
    }

    const startIdx = rowRange.startIndex;
    const endIdx = Math.min(rowRange.endIndex, visibleRows.length);
    for (let i = startIdx; i < endIdx; i++) {
      const r = visibleRows[i];

      // Resolve a "sequence" for this row. Leaves use the host-provided
      // alignment directly; collapsed summaries fall back to a per-column
      // consensus across their subtree's (non-pruned) leaves.
      let getCh: ((col: number) => string | undefined) | null = null;
      let consensusRow = false;
      if (r.kind === 'leaf') {
        const node = data.tree.nodes[r.nodeId];
        const seq = node?.geneId ? msa.sequences[node.geneId] : undefined;
        if (seq) getCh = (col) => seq[col];
      } else if (r.kind === 'collapsedSummary') {
        const ids = leafGeneIdsByNode(r.nodeId);
        if (ids.length > 0) {
          getCh = (col) => consensusAt(ids, msa.sequences, col) ?? undefined;
          consensusRow = true;
        }
      }
      if (!getCh) continue;

      const rowYCenter = r.y + r.height / 2;
      const baseOpacity = r.opacity ?? 1;
      const rowOpacity = consensusRow ? baseOpacity * CONSENSUS_OPACITY : baseOpacity;
      const rowTx = -32 * (1 - baseOpacity);
      ctx.globalAlpha = rowOpacity;
      ctx.save();
      ctx.translate(rowTx, 0);
      if (renderText) {
        for (let vCol = vp.start; vCol < vp.end; vCol++) {
          const oCol = visibleCols ? visibleCols[vCol] : vCol;
          if (oCol === undefined) continue;
          const ch = getCh(oCol);
          if (!ch || ch === '-') continue;
          ctx.fillStyle = scheme.color(ch) ?? RESIDUE_COLOR;
          const x = PAD_X + (vCol - vp.start + 0.5) * residueWidth;
          ctx.fillText(ch, x, rowYCenter);
        }
      } else {
        for (let vCol = vp.start; vCol < vp.end; vCol++) {
          const oCol = visibleCols ? visibleCols[vCol] : vCol;
          if (oCol === undefined) continue;
          const ch = getCh(oCol);
          if (!ch || ch === '-') continue;
          ctx.fillStyle = scheme.color(ch) ?? RESIDUE_BG_COLOR;
          const x = PAD_X + (vCol - vp.start) * residueWidth;
          ctx.fillRect(x, r.y + 2, Math.max(residueWidth, 0.5), r.height - 4);
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Mask-run markers are rendered as an SVG overlay outside this paint
    // pass so they can be interactive (hover tooltip + click to toggle).
  }, [
    msa,
    visibleRows,
    rowRange.startIndex,
    rowRange.endIndex,
    width,
    totalHeight,
    zoneState.viewportStart,
    zoneState.viewportEnd,
    zoneState.colorSchemeId,
    data.tree,
    leafGeneIdsByNode,
    mask,
    totalVisible,
  ]);

  // Wheel handler: deltaX → pan, ctrl/shift + deltaY → zoom centred on cursor.
  // Has to be attached via native addEventListener (passive: false) because
  // React's synthetic onWheel is passive and can't preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !msa) return;
    const handler = (e: WheelEvent) => {
      const vp = resolveViewport(zoneState, totalVisible);
      const innerWidth = Math.max(1, width - 2 * PAD_X);
      const length = vp.end - vp.start;

      if (e.ctrlKey || e.shiftKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - PAD_X;
        const clamped = Math.max(0, Math.min(innerWidth, cursorX));
        const cursorCol = vp.start + (clamped / innerWidth) * length;
        const factor = Math.exp(e.deltaY * 0.002);
        let newLength = Math.round(length * factor);
        newLength = Math.max(2, Math.min(totalVisible, newLength));
        let newStart = Math.round(cursorCol - (clamped / innerWidth) * newLength);
        newStart = Math.max(0, Math.min(totalVisible - newLength, newStart));
        setZoneState((s) => ({
          ...s,
          viewportStart: newStart,
          viewportEnd: newStart + newLength,
        }));
        return;
      }

      if (e.deltaX !== 0) {
        e.preventDefault();
        const panSpeed = length / innerWidth;
        let newStart = Math.round(vp.start + e.deltaX * panSpeed);
        newStart = Math.max(0, Math.min(totalVisible - length, newStart));
        if (newStart === vp.start) return;
        setZoneState((s) => ({
          ...s,
          viewportStart: newStart,
          viewportEnd: newStart + length,
        }));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [msa, width, zoneState.viewportStart, zoneState.viewportEnd, totalVisible, setZoneState]);

  if (!msa) {
    return (
      <div style={{ padding: '8px 10px', fontSize: 12, color: '#888' }}>
        No alignment provided
      </div>
    );
  }

  // Render row-aligned hit overlays (for hover/select) on top of the canvas.
  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

  // Mask-run markers as an interactive SVG overlay above the body. Each run
  // gets a downward triangle when collapsed, or a downward trapezoid (top
  // edge spanning the run width) when expanded. Click toggles. Title shows
  // the original-column range and run length.
  const vpForOverlay = msa ? resolveViewport(zoneState, totalVisible) : null;
  const innerWidthForOverlay = Math.max(1, width - 2 * PAD_X);
  const overlayResidueWidth =
    vpForOverlay && vpForOverlay.width > 0
      ? innerWidthForOverlay / vpForOverlay.width
      : 0;

  const toggleRun = (start: number) => {
    setZoneState((s) => {
      const params = s.mask ?? DEFAULT_MASK;
      const cur = new Set(params.expandedRuns ?? []);
      if (cur.has(start)) cur.delete(start);
      else cur.add(start);
      return {
        ...s,
        mask: { ...params, expandedRuns: [...cur].sort((a, b) => a - b) },
      };
    });
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height: totalHeight,
          pointerEvents: 'none',
        }}
      />
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
              right: 0,
              height: r.height,
              cursor: 'pointer',
              background: isSelected
                ? 'rgba(40, 120, 220, 0.12)'
                : isExactHover
                  ? 'rgba(40, 120, 220, 0.06)'
                  : isInHoveredSubtree
                    ? 'rgba(40, 120, 220, 0.03)'
                    : 'transparent',
              borderBottom: '1px solid rgba(0, 0, 0, 0.04)',
              opacity: r.opacity ?? 1,
              transform: `translateX(${-32 * (1 - (r.opacity ?? 1))}px)`,
            }}
          />
        );
      })}
      {mask && mask.runs.length > 0 && vpForOverlay && (
        <svg
          width={width}
          height={8}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {mask.runs.map((run) => {
            const cols = run.end - run.start + 1;
            // Marker visibility: a closed run sits between visibleCols[visibleAt-1]
            // and visibleCols[visibleAt]; an expanded run spans visibleCols
            // [visibleAt .. visibleAt+cols-1]. Skip if entirely outside viewport.
            const runVStart = run.visibleAt;
            const runVEnd = run.expanded ? run.visibleAt + cols : run.visibleAt;
            if (runVEnd < vpForOverlay.start || runVStart > vpForOverlay.end) return null;

            const colXAt = (vCol: number) =>
              PAD_X + (vCol - vpForOverlay.start) * overlayResidueWidth;

            const fill = run.expanded ? 'rgba(40, 120, 220, 0.85)' : '#888';
            const stroke = run.expanded ? '#1d5fb1' : '#666';
            const handlers = {
              style: { pointerEvents: 'auto' as const, cursor: 'pointer' },
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                toggleRun(run.start);
              },
            };
            const title = (
              <title>
                {run.expanded
                  ? `Showing ${cols} masked column${cols === 1 ? '' : 's'} (${run.start + 1}–${run.end + 1}). Click to hide.`
                  : `${cols} column${cols === 1 ? '' : 's'} hidden (${run.start + 1}–${run.end + 1}). Click to show.`}
              </title>
            );

            if (!run.expanded) {
              const x = colXAt(run.visibleAt);
              return (
                <polygon
                  key={`runmarker-${run.start}`}
                  points={`${x - 3.5},0 ${x + 3.5},0 ${x},6`}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.5}
                  {...handlers}
                >
                  {title}
                </polygon>
              );
            }

            // Expanded: split the original isosceles triangle in half vertically
            // and slide the halves out to flank a rectangle that fills the run
            // width. Combined silhouette is a trapezoid (top L-3.5..R+3.5,
            // bottom L..R) but it's three pieces.
            const L = colXAt(run.visibleAt);
            const R = colXAt(run.visibleAt + cols);
            return (
              <g key={`runmarker-${run.start}`} {...handlers}>
                <polygon
                  points={`${L - 3.5},0 ${L},0 ${L},6`}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.5}
                />
                <rect
                  x={L}
                  y={0}
                  width={Math.max(0, R - L)}
                  height={6}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.5}
                />
                <polygon
                  points={`${R},0 ${R + 3.5},0 ${R},6`}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={0.5}
                />
                {title}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
};

export const msaZone: ZoneDefinition<MSAZoneState> = {
  id: 'msa',
  displayName: 'MSA',
  Header: MSAHeader,
  Body: MSABody,
  defaultWidth: 360,
  minWidth: 120,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) => Boolean(data.msa),
};

// Helpers referenced from sibling files in later slices (minimap, pan/zoom).
export { resolveViewport };
export type { ResolvedViewport };
