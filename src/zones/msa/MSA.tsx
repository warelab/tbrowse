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

export interface MSAZoneState {
  /** First visible-column (inclusive) of the viewport. */
  viewportStart: number;
  /** Last visible-column (exclusive). When <= viewportStart, treat as "full alignment". */
  viewportEnd: number;
  /** Optional. Falls back to defaultSchemeFor(alphabet) when undefined. */
  colorSchemeId?: ColorSchemeId;
  /** Mask parameters. When undefined, defaults are used. */
  mask?: { enabled: boolean; minCoverage: number; padding: number };
}

const DEFAULT_STATE: MSAZoneState = { viewportStart: 0, viewportEnd: 0 };
const DEFAULT_MASK = { enabled: true, minCoverage: 1, padding: 5 };

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
}: ZoneRenderProps<MSAZoneState>) => {
  const msa = data.msa;
  const maskParams = zoneState.mask ?? DEFAULT_MASK;
  const activeGeneIds = useMemo(
    () => (msa ? computeActiveGeneIds(data.tree, msa, prunedNodeIds) : new Set<GeneId>()),
    [msa, data.tree, prunedNodeIds],
  );
  const mask = useMemo<MSAMask | null>(() => {
    if (!msa) return null;
    return maskParams.enabled
      ? computeMSAMask(msa, activeGeneIds, maskParams.minCoverage, maskParams.padding)
      : unmaskedMSA(msa);
  }, [msa, activeGeneIds, maskParams.enabled, maskParams.minCoverage, maskParams.padding]);
  const totalVisible = mask?.visibleCols.length ?? 0;
  const vp = msa ? resolveViewport(zoneState, totalVisible) : null;

  // Coverage over visible columns only — fed to the minimap.
  const coverage = useMemo(() => {
    if (!msa || !mask) return new Float32Array(0);
    const out = new Float32Array(mask.visibleCols.length);
    if (activeGeneIds.size === 0) return out;
    const ids = [...activeGeneIds];
    const denom = ids.length;
    for (let i = 0; i < mask.visibleCols.length; i++) {
      const col = mask.visibleCols[i];
      let nonGap = 0;
      for (const id of ids) {
        const ch = msa.sequences[id]?.[col];
        if (ch && ch !== '-') nonGap++;
      }
      out[i] = nonGap / denom;
    }
    return out;
  }, [msa, mask, activeGeneIds]);

  const setViewport = useCallback(
    (start: number, end: number) =>
      setZoneState((s) => ({ ...s, viewportStart: start, viewportEnd: end })),
    [setZoneState],
  );

  return (
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
          <Minimap
            coverage={coverage}
            totalCols={totalVisible}
            vp={vp}
            onSetViewport={setViewport}
          />
        </>
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
  const mask = useMemo<MSAMask | null>(() => {
    if (!msa) return null;
    return maskParams.enabled
      ? computeMSAMask(msa, activeGeneIds, maskParams.minCoverage, maskParams.padding)
      : unmaskedMSA(msa);
  }, [msa, activeGeneIds, maskParams.enabled, maskParams.minCoverage, maskParams.padding]);
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

    // Triangle markers for hidden runs that fall inside the viewport. Rendered
    // at the very top of the canvas (y 0..6) so they sit above the first row;
    // canvas y=0 is the top of the body, which is just under the sticky header.
    if (mask && mask.hiddenRuns.length > 0 && visibleCols) {
      ctx.fillStyle = '#888';
      ctx.beginPath();
      // Draw a small downward triangle wherever two adjacent visible columns
      // (within the viewport) flank a hidden run in the original alignment.
      for (let vCol = vp.start; vCol + 1 < vp.end; vCol++) {
        const oCol = visibleCols[vCol];
        const nextOCol = visibleCols[vCol + 1];
        if (oCol === undefined || nextOCol === undefined) continue;
        if (nextOCol > oCol + 1) {
          const x = PAD_X + (vCol - vp.start + 1) * residueWidth;
          ctx.moveTo(x - 3.5, 0);
          ctx.lineTo(x + 3.5, 0);
          ctx.lineTo(x, 5.5);
          ctx.closePath();
        }
      }
      ctx.fill();
    }
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
