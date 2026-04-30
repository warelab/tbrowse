import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildChildrenIndex, subtreeIdsOf } from '../../treeIndex';
import type {
  GeneId,
  MSA,
  NodeId,
  ProteinDomain,
  ZoneDefinition,
  ZoneRenderProps,
} from '../../types';
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
import {
  buildResidueToColumn,
  computeDominantDomainByCol,
  domainColor,
  domainColumnRange,
} from './domains';

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
/** Protein-only: above this residue width the body switches from single-
 *  letter to 3-letter amino acid codes. */
const THREE_LETTER_MIN_PX = 22;
/** Protein-only zoom cap. The wheel zoom and minimap edge drags clamp the
 *  viewport so each visible column gets at most this many pixels — i.e.
 *  enough room to render a 3-letter code (with a sliver of breathing room).
 *  The future "render codons under each AA" affordance will live in this
 *  same column footprint. */
const MAX_RESIDUE_PX_PROTEIN = 28;
const RESIDUE_COLOR = '#444';
const RESIDUE_BG_COLOR = '#cfd6df';
const CONSENSUS_OPACITY = 0.7;

/** Single-letter → 3-letter amino acid code. Includes the standard 20 plus
 *  the IUPAC ambiguity codes and a few uncommon residues. Lookup is upper-
 *  case; lower-case input is handled at the call site. */
const AA_THREE_LETTER: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys',
  E: 'Glu', Q: 'Gln', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  B: 'Asx', Z: 'Glx', X: 'Xaa', U: 'Sec', O: 'Pyl',
};

/** Smallest viewport length (in visible columns) allowed by the zoom cap.
 *  Returns 2 for non-protein alignments. */
function minViewportLength(alphabet: MSA['alphabet'], innerWidth: number): number {
  if (alphabet === 'protein' && innerWidth > 0) {
    return Math.max(2, Math.ceil(innerWidth / MAX_RESIDUE_PX_PROTEIN));
  }
  return 2;
}

/**
 * Returns an array of length `msa.length`, one entry per ORIGINAL column,
 * giving the most-common non-gap residue across the supplied sequences (or
 * null when every contributor is a gap).
 *
 * Caching one of these per (msa, activeGeneIds) lets the header consensus
 * track and each collapsed-summary row recover its residue in O(1) per
 * column on subsequent renders, instead of re-counting every visible column
 * after each mask toggle / scroll / hover.
 */
function computeConsensusArray(
  geneIds: readonly GeneId[],
  sequences: MSA['sequences'],
  length: number,
): (string | null)[] {
  const result = new Array<string | null>(length).fill(null);
  if (geneIds.length === 0) return result;
  // Pre-resolve sequences once (avoids per-column hash lookups).
  const seqs: string[] = [];
  for (const id of geneIds) {
    const s = sequences[id];
    if (s) seqs.push(s);
  }
  for (let col = 0; col < length; col++) {
    const counts: Record<string, number> = {};
    let bestCh: string | null = null;
    let bestN = 0;
    for (const s of seqs) {
      const ch = s[col];
      if (!ch || ch === '-') continue;
      const n = (counts[ch] ?? 0) + 1;
      counts[ch] = n;
      if (n > bestN) {
        bestN = n;
        bestCh = ch;
      }
    }
    result[col] = bestCh;
  }
  return result;
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
  // (Header no longer reads the residue scheme — the minimap is always
  // domain-coloured. The body keeps its own scheme for residue rendering.)

  // Per-original-column consensus residue across every active leaf. The
  // expensive part (counting residues across geneIds × cols) only re-runs
  // when the alignment or the active leaf set changes — NOT when the user
  // pans, toggles a mask run, or switches color schemes.
  const consensusByCol = useMemo(() => {
    if (!msa) return null;
    return computeConsensusArray([...activeGeneIds], msa.sequences, msa.length);
  }, [msa, activeGeneIds]);

  // Per-original-column dominant domain id (used by the minimap to colour
  // the consensus track regardless of which residue scheme the body is
  // using). Re-runs only when the alignment, domain set, or active leaves
  // change.
  const dominantDomainByCol = useMemo(() => {
    if (!msa) return null;
    return computeDominantDomainByCol(msa, data.proteinDomains, activeGeneIds);
  }, [msa, data.proteinDomains, activeGeneIds]);

  // Cheap O(visibleCols) projection: pick the residues for the currently
  // visible columns and choose a colour. The minimap is intentionally
  // "plain" — i.e. it always shows DOMAIN colours, never residue colours,
  // so it acts as a domain-organisation summary alongside the body's
  // residue rendering.
  const consensus = useMemo(() => {
    if (!consensusByCol || !mask) {
      return { residues: [] as (string | null)[], colors: [] as (string | null)[] };
    }
    const residues = new Array<string | null>(mask.visibleCols.length);
    const colors = new Array<string | null>(mask.visibleCols.length);
    for (let i = 0; i < mask.visibleCols.length; i++) {
      const oCol = mask.visibleCols[i];
      const ch = consensusByCol[oCol] ?? null;
      residues[i] = ch;
      const did = dominantDomainByCol?.[oCol] ?? null;
      if (did) {
        colors[i] = domainColor(did);
      } else if (ch) {
        // Non-gap consensus, no domain → neutral mid-grey so the minimap
        // still reads as "alignment exists here".
        colors[i] = '#cfd6df';
      } else {
        colors[i] = null;
      }
    }
    return { residues, colors };
  }, [consensusByCol, mask, dominantDomainByCol]);

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
  const minVpLength = msa
    ? Math.min(totalVisible || Infinity, minViewportLength(msa.alphabet, minimapWidth))
    : 2;
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
            minLength={minVpLength}
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

  // Per-collapsed-node consensus residue array, lazily computed on first
  // access and reused across re-renders. Same invalidation key as
  // leafGeneIdsByNode (tree / prunes / msa change) so any change that
  // shifts the active leaf set drops the cache.
  const consensusByNode = useMemo(() => {
    const cache = new Map<NodeId, (string | null)[]>();
    return (rootId: NodeId): (string | null)[] | null => {
      if (!msa) return null;
      const cached = cache.get(rootId);
      if (cached) return cached;
      const ids = leafGeneIdsByNode(rootId);
      if (ids.length === 0) return null;
      const arr = computeConsensusArray(ids, msa.sequences, msa.length);
      cache.set(rootId, arr);
      return arr;
    };
  }, [msa, leafGeneIdsByNode]);

  // Per-original-column dominant domain id (used by the body's "Plain"
  // colour scheme to colour each residue by its enclosing domain).
  const dominantDomainByCol = useMemo(() => {
    if (!msa) return null;
    return computeDominantDomainByCol(msa, data.proteinDomains, activeGeneIds);
  }, [msa, data.proteinDomains, activeGeneIds]);

  // Lazily-built per-leaf residue → column lookup table. Reused across
  // re-renders for as long as the MSA reference is stable, so toggling
  // hovers / scrolling never re-walks a sequence.
  const colByResidue = useMemo(() => {
    const cache = new Map<GeneId, number[]>();
    return (geneId: GeneId): number[] => {
      const cached = cache.get(geneId);
      if (cached) return cached;
      const seq = msa?.sequences[geneId] ?? '';
      const map = buildResidueToColumn(seq);
      cache.set(geneId, map);
      return map;
    };
  }, [msa]);

  // Per-domain-hit bar segments, restricted to (a) currently visible rows
  // and (b) the current viewport's visible-column window. A domain that
  // straddles a masked region renders as multiple contiguous segments.
  type DomainBar = {
    key: string;
    rowY: number;
    rowH: number;
    /** First and last visible-col indices for this segment (inclusive). */
    startVCol: number;
    endVCol: number;
    id: string;
    name: string;
    source?: string;
    nodeId: NodeId;
  };
  const domainBars = useMemo<DomainBar[]>(() => {
    if (!msa || !data.proteinDomains || !mask) return [];
    // original col → visible col index (only present when not masked).
    const visibleByOriginal = new Map<number, number>();
    for (let i = 0; i < mask.visibleCols.length; i++) {
      visibleByOriginal.set(mask.visibleCols[i], i);
    }
    const startIdx = rowRange.startIndex;
    const endIdx = Math.min(rowRange.endIndex, visibleRows.length);
    const bars: DomainBar[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      const r = visibleRows[i];
      if (r.kind !== 'leaf') continue;
      const node = data.tree.nodes[r.nodeId];
      if (!node?.geneId) continue;
      const domains = data.proteinDomains[node.geneId];
      if (!domains?.length) continue;
      const map = colByResidue(node.geneId);
      for (const d of domains) {
        const range = domainColumnRange(d, map);
        if (!range) continue;
        // Walk the original-col span and group contiguous visible cols.
        let runStart = -1;
        let runEnd = -1;
        for (let oCol = range.startCol; oCol <= range.endCol; oCol++) {
          const vCol = visibleByOriginal.get(oCol);
          if (vCol === undefined) {
            if (runStart >= 0) {
              bars.push({
                key: `${r.nodeId}:${d.id}:${runStart}`,
                rowY: r.y,
                rowH: r.height,
                startVCol: runStart,
                endVCol: runEnd,
                id: d.id,
                name: d.name,
                source: d.source,
                nodeId: r.nodeId,
              });
              runStart = -1;
            }
            continue;
          }
          if (runStart < 0) runStart = vCol;
          runEnd = vCol;
        }
        if (runStart >= 0) {
          bars.push({
            key: `${r.nodeId}:${d.id}:${runStart}`,
            rowY: r.y,
            rowH: r.height,
            startVCol: runStart,
            endVCol: runEnd,
            id: d.id,
            name: d.name,
            source: d.source,
            nodeId: r.nodeId,
          });
        }
      }
    }
    return bars;
  }, [
    msa,
    mask,
    data.proteinDomains,
    data.tree,
    visibleRows,
    rowRange.startIndex,
    rowRange.endIndex,
    colByResidue,
  ]);

  // Tree-wide domain frequency: how many leaves carry at least one hit for
  // each domain id, against the total leaf count of the entire tree. Used
  // by the click tooltip to put each hit in context ("appears in 4/5
  // leaves"). Computed once per (proteinDomains, tree) change.
  const domainStats = useMemo(() => {
    const freq = new Map<string, number>();
    let totalLeaves = 0;
    for (const node of Object.values(data.tree.nodes)) {
      if (!node.isLeaf) continue;
      totalLeaves++;
      const hits = node.geneId ? data.proteinDomains?.[node.geneId] : undefined;
      if (!hits || hits.length === 0) continue;
      const seen = new Set<string>();
      for (const h of hits) seen.add(h.id);
      for (const id of seen) freq.set(id, (freq.get(id) ?? 0) + 1);
    }
    return { freq, totalLeaves };
  }, [data.proteinDomains, data.tree]);

  // Click-driven tooltip listing the domains overlapping (clickedRow,
  // clickedColumn). Held as local UI state — not part of viewState — so
  // closing it doesn't pollute the URL. Cleared by a click outside the
  // body or pressing Escape.
  type DomainTip = {
    screenX: number;
    screenY: number;
    leafName: string;
    geneId: GeneId;
    domains: ProteinDomain[];
  };
  const [domainTip, setDomainTip] = useState<DomainTip | null>(null);
  useEffect(() => {
    if (!domainTip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDomainTip(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [domainTip]);

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
    // "Plain" scheme means colour residues by the dominant domain at their
    // column. The lookup below short-circuits to scheme.color for every
    // other scheme so the hot loop pays no extra cost.
    const usePlainDomainColors = scheme.id === 'plain' && dominantDomainByCol !== null;
    const colorAt = (oCol: number, ch: string): string | null => {
      if (usePlainDomainColors) {
        const did = dominantDomainByCol![oCol];
        return did ? domainColor(did) : null;
      }
      return scheme.color(ch);
    };

    const renderText = residueWidth >= TEXT_RENDER_MIN_PX;
    // Above THREE_LETTER_MIN_PX, protein columns get the 3-letter abbreviation
    // (Ala, Arg, ...) so the wide column doesn't look empty. Future codon
    // rendering will draw a second line below this one in the same column.
    const renderThreeLetter =
      renderText && msa.alphabet === 'protein' && residueWidth >= THREE_LETTER_MIN_PX;
    if (renderText) {
      ctx.font = renderThreeLetter
        ? '10px ui-monospace, "SF Mono", Menlo, monospace'
        : '11px ui-monospace, "SF Mono", Menlo, monospace';
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
        const arr = consensusByNode(r.nodeId);
        if (arr) {
          getCh = (col) => arr[col] ?? undefined;
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
          ctx.fillStyle = colorAt(oCol, ch) ?? RESIDUE_COLOR;
          const x = PAD_X + (vCol - vp.start + 0.5) * residueWidth;
          const text = renderThreeLetter
            ? (AA_THREE_LETTER[ch.toUpperCase()] ?? ch)
            : ch;
          ctx.fillText(text, x, rowYCenter);
        }
      } else {
        // Snap each column's CSS-pixel boundaries so adjacent fills abut
        // exactly. Avoids the sub-pixel seams that show as faint vertical
        // lines under plain/domain colouring at small residueWidth.
        for (let vCol = vp.start; vCol < vp.end; vCol++) {
          const oCol = visibleCols ? visibleCols[vCol] : vCol;
          if (oCol === undefined) continue;
          const ch = getCh(oCol);
          if (!ch || ch === '-') continue;
          ctx.fillStyle = colorAt(oCol, ch) ?? RESIDUE_BG_COLOR;
          const x0 = PAD_X + Math.round((vCol - vp.start) * residueWidth);
          const x1 = PAD_X + Math.round((vCol - vp.start + 1) * residueWidth);
          ctx.fillRect(x0, r.y + 2, Math.max(1, x1 - x0), r.height - 4);
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
    consensusByNode,
    dominantDomainByCol,
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
        const minLen = Math.min(totalVisible, minViewportLength(msa.alphabet, innerWidth));
        let newLength = Math.round(length * factor);
        newLength = Math.max(minLen, Math.min(totalVisible, newLength));
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

  // Body click → if a leaf row + column intersection has any domain hits
  // overlapping, open the domain tooltip. Otherwise no-op (in particular,
  // does NOT call onSelectNode — node selection lives in the tree zone).
  const onBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!msa || !mask || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const vp = resolveViewport(zoneState, totalVisible);
    const innerW = Math.max(1, width - 2 * PAD_X);
    const residueW = innerW / vp.width;
    const insideX = localX - PAD_X;
    if (insideX < 0 || insideX > innerW) return;
    const vCol = vp.start + Math.floor(insideX / residueW);
    if (vCol < vp.start || vCol >= vp.end) return;
    const oCol = mask.visibleCols[vCol];
    if (oCol === undefined) return;

    // Find which row contains localY. visibleRows are y-sorted with no
    // overlaps, so a linear scan is fine — bounded by virtualization.
    const startIdx = rowRange.startIndex;
    const endIdx = Math.min(rowRange.endIndex, visibleRows.length);
    let row: (typeof visibleRows)[number] | null = null;
    for (let i = startIdx; i < endIdx; i++) {
      const r = visibleRows[i];
      if (localY >= r.y && localY < r.y + r.height) {
        row = r;
        break;
      }
    }
    if (!row || row.kind !== 'leaf') return;
    const node = data.tree.nodes[row.nodeId];
    if (!node?.geneId) return;
    const hits = data.proteinDomains?.[node.geneId];
    if (!hits || hits.length === 0) return;
    const map = colByResidue(node.geneId);
    const overlapping = hits.filter((d) => {
      const r = domainColumnRange(d, map);
      return r !== null && oCol >= r.startCol && oCol <= r.endCol;
    });
    if (overlapping.length === 0) return;

    setDomainTip({
      screenX: e.clientX,
      screenY: e.clientY,
      leafName:
        (data.geneMetadata?.[node.geneId] as { displayName?: string } | undefined)
          ?.displayName ?? node.geneId,
      geneId: node.geneId,
      domains: overlapping,
    });
  };

  return (
    <div
      ref={containerRef}
      onClick={onBodyClick}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
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
            style={{
              position: 'absolute',
              top: r.y,
              left: 0,
              right: 0,
              height: r.height,
              // No click-to-select in MSA — clicks are handled at the body
              // level and either open the domain tooltip or do nothing.
              cursor: 'default',
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
      {/* Domain bars: thin coloured strips at the bottom of each leaf
          row showing protein domains in the current viewport. The parent
          SVG has pointerEvents:none so events still reach the row hit
          overlays for non-bar pixels; each rect re-enables pointer events
          so its <title> can serve as a hover tooltip. */}
      {domainBars.length > 0 && vpForOverlay && (
        <svg
          width={width}
          height={totalHeight}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        >
          {domainBars.map((b) => {
            const x1 = PAD_X + (b.startVCol - vpForOverlay.start) * overlayResidueWidth;
            const x2 = PAD_X + (b.endVCol - vpForOverlay.start + 1) * overlayResidueWidth;
            // Skip bars that fall entirely outside the visible viewport.
            if (x2 <= PAD_X || x1 >= PAD_X + innerWidthForOverlay) return null;
            const xClipped1 = Math.max(PAD_X, x1);
            const xClipped2 = Math.min(PAD_X + innerWidthForOverlay, x2);
            const w = Math.max(1, xClipped2 - xClipped1);
            return (
              // Bars are passive visual markers; click handling is at the
              // body level so any click in the row + column intersection
              // (whether on the bar or just on its row pixels) opens the
              // domain tooltip.
              <rect
                key={b.key}
                x={xClipped1}
                y={b.rowY + b.rowH - 3}
                width={w}
                height={2}
                fill={domainColor(b.id)}
                pointerEvents="none"
              />
            );
          })}
        </svg>
      )}
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
      {domainTip && (
        <DomainTooltip
          tip={domainTip}
          stats={domainStats}
          onClose={() => setDomainTip(null)}
        />
      )}
    </div>
  );
};

/**
 * Compact floating tooltip listing every domain that overlaps the clicked
 * (leaf, column) intersection, with each hit's tree-wide frequency. Closed
 * on outside click or Escape (Escape handled by the parent body).
 */
function DomainTooltip({
  tip,
  stats,
  onClose,
}: {
  tip: {
    screenX: number;
    screenY: number;
    leafName: string;
    geneId: GeneId;
    domains: ProteinDomain[];
  };
  stats: { freq: Map<string, number>; totalLeaves: number };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    // Defer to skip the click that opened us.
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
    };
  }, [onClose]);

  // Clamp into the viewport so a click near the right/bottom edge doesn't
  // push the tooltip off-screen.
  const margin = 8;
  const estW = 280;
  const estH = 24 + tip.domains.length * 36;
  const left = Math.min(tip.screenX + 12, window.innerWidth - estW - margin);
  const top = Math.min(tip.screenY + 12, window.innerHeight - estH - margin);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 1000,
        background: 'white',
        border: '1px solid #d0d0d0',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
        padding: '8px 10px',
        fontSize: 12,
        color: '#222',
        maxWidth: 320,
        minWidth: 180,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 6,
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 600 }}>{tip.leafName}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: 14,
            cursor: 'pointer',
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tip.domains.map((d) => {
          const seenIn = stats.freq.get(d.id) ?? 0;
          const total = stats.totalLeaves;
          const pct = total > 0 ? Math.round((seenIn / total) * 100) : 0;
          return (
            <div
              key={d.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: domainColor(d.id),
                  flex: '0 0 auto',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{d.name}</div>
                <div style={{ color: '#777', fontSize: 11 }}>
                  {d.id}
                  {d.source ? ` · ${d.source}` : ''} · residues {d.start}–{d.end}
                </div>
                <div style={{ color: '#555', fontSize: 11 }}>
                  in {seenIn} / {total} leaves ({pct}%)
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
