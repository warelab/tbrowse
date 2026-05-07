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
import { defaultSchemeFor, getScheme, type ColorSchemeId } from './coloring';
import { computeMSAMask, unmaskedMSA, type MSAMask } from './mask';
import { MSAConfigPopover } from './ConfigPopover';
import { Minimap } from './Minimap';
import { EditableZoneName } from '../EditableZoneName';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';
import {
  buildResidueToColumn,
  computeDominantDomainByCol,
  domainColor,
  domainColumnRange,
} from './domains';

export interface MSAZoneState {
  /** User-set zone name; falls back to the factory default when undefined. */
  name?: string;
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
/** Below this residue width, individual residue colours stop being legible —
 *  the per-column fills smear together. When the host has supplied domain
 *  data, the body silently switches to the "Domains" colouring at that zoom
 *  level even if the user has Clustal/etc. selected, since domain
 *  organisation reads much better than residue colour at this scale. The
 *  user's scheme preference is preserved (the dropdown is unchanged); this
 *  is purely a render-time override. */
const AUTO_DOMAIN_RESIDUE_PX = 5;
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
 * Per-column coverage: fraction of `geneIds` whose sequence has a non-gap
 * residue at that column. Range [0, 1]. Used by the minimap to fade the
 * consensus track in low-coverage columns so the user can tell at a glance
 * which regions are well-supported across the alignment.
 *
 * Same complexity as computeConsensusArray (O(geneIds × length)). Cached
 * by (msa, activeGeneIds) so it doesn't re-run on scroll/mask/scheme
 * changes.
 */
function computeCoverageArray(
  geneIds: readonly GeneId[],
  sequences: MSA['sequences'],
  length: number,
): number[] {
  const counts = new Array<number>(length).fill(0);
  if (geneIds.length === 0) return counts;
  let total = 0;
  for (const id of geneIds) {
    const seq = sequences[id];
    if (!seq) continue;
    total++;
    for (let c = 0; c < length; c++) {
      const ch = seq[c];
      if (ch && ch !== '-' && ch !== '.') counts[c] += 1;
    }
  }
  if (total > 0) {
    for (let c = 0; c < length; c++) counts[c] = counts[c] / total;
  }
  return counts;
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

  // Per-original-column coverage (fraction of active leaves with a non-gap
  // residue). Used as alpha on the minimap so sparsely-covered regions
  // visually fade out.
  const coverageByCol = useMemo(() => {
    if (!msa) return null;
    return computeCoverageArray([...activeGeneIds], msa.sequences, msa.length);
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
  // "plain" — gaps render empty, non-gap columns are coloured by their
  // dominant domain (or a neutral grey when none) and their alpha tracks
  // per-column coverage so sparsely-supported regions fade out.
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
      if (!ch) {
        // All-gap consensus → empty pixel (background shows through).
        colors[i] = null;
        continue;
      }
      // Coverage = fraction of active leaves with a non-gap residue at
      // this column; use it as the column's alpha so partial-coverage
      // columns are visibly faded.
      const cov = Math.max(0, Math.min(1, coverageByCol?.[oCol] ?? 1));
      const did = dominantDomainByCol?.[oCol] ?? null;
      colors[i] = did
        ? domainColor(did, cov)
        : `hsl(220 10% 45% / ${cov})`;
    }
    return { residues, colors };
  }, [consensusByCol, coverageByCol, mask, dominantDomainByCol]);

  const setViewport = useCallback(
    (start: number, end: number) =>
      setZoneState((s) => ({ ...s, viewportStart: start, viewportEnd: end })),
    [setZoneState],
  );

  // Snap zoom to "letters become visible" — the smallest viewport length
  // such that residueWidth ≥ TEXT_RENDER_MIN_PX. Centred on the current
  // viewport so the user's reference point stays put. Disabled when the
  // alignment can't fit at this zoom (totalVisible too small) or when
  // we're already at exactly that length.
  const lettersVpLength = useMemo(() => {
    if (!msa) return null;
    const innerW = Math.max(1, width - 2 * PAD_X);
    const target = Math.max(2, Math.floor(innerW / TEXT_RENDER_MIN_PX));
    const minLen = Math.max(2, minViewportLength(msa.alphabet, innerW));
    return Math.max(minLen, Math.min(totalVisible, target));
  }, [msa, width, totalVisible]);
  const zoomToLetters = useCallback(() => {
    if (lettersVpLength === null || !vp) return;
    const center = (vp.start + vp.end) / 2;
    let newStart = Math.round(center - lettersVpLength / 2);
    newStart = Math.max(0, Math.min(totalVisible - lettersVpLength, newStart));
    setViewport(newStart, newStart + lettersVpLength);
  }, [lettersVpLength, vp, totalVisible, setViewport]);

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
      data-msa-zone-header
      style={{
        position: 'relative',
        height: '100%',
        fontSize: 13,
        color: 'var(--tbrowse-text)',
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
        <EditableZoneName
          defaultName="MSA"
          customName={zoneState.name}
          onChange={(next) =>
            setZoneState((s) => ({ ...s, name: next }))
          }
        />
        {msa && vp && (
          <>
            <button
              type="button"
              onClick={zoomToLetters}
              disabled={
                lettersVpLength === null || vp.end - vp.start === lettersVpLength
              }
              title="Zoom to the level where residue letters become visible"
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid var(--tbrowse-border)',
                background: 'var(--tbrowse-bg-input)',
                color: 'var(--tbrowse-text)',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              }}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setViewport(0, totalVisible)}
              disabled={vp.start === 0 && vp.end === totalVisible}
              title="Zoom out to the full alignment"
              style={{
                fontSize: 11,
                padding: '2px 6px',
                border: '1px solid var(--tbrowse-border)',
                background: 'var(--tbrowse-bg-input)',
                color: 'var(--tbrowse-text)',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              }}
            >
              {'<->'}
            </button>
            <span style={{ marginLeft: 'auto' }}>
              <MSAConfigPopover
                msa={msa}
                zoneState={zoneState}
                setZoneState={setZoneState}
                hasDomains={
                  !!data.proteinDomains &&
                  Object.keys(data.proteinDomains).length > 0
                }
                mask={{
                  params: maskParams,
                  maxCoverage: activeGeneIds.size,
                  hiddenCols: msa.length - totalVisible,
                  totalCols: msa.length,
                  onChange: (next) =>
                    setZoneState((s) => ({ ...s, mask: next })),
                }}
              />
            </span>
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

  // Lazily-built per-leaf "domain id at column" lookup table for the
  // "Domains" / plain scheme. For each gene id with hits, returns an
  // array of length msa.length where entry[col] is one of the leaf's
  // own domain ids (or null when no hit covers this column on this
  // leaf). When two of a leaf's hits overlap the same column the first
  // hit wins, which is plenty for visual coloring.
  const domainByColForLeaf = useMemo(() => {
    const cache = new Map<GeneId, (string | null)[]>();
    return (geneId: GeneId): (string | null)[] | null => {
      if (!msa || !data.proteinDomains) return null;
      const cached = cache.get(geneId);
      if (cached) return cached;
      const hits = data.proteinDomains[geneId];
      if (!hits || hits.length === 0) return null;
      const map = colByResidue(geneId);
      const out = new Array<string | null>(msa.length).fill(null);
      for (const d of hits) {
        const range = domainColumnRange(d, map);
        if (!range) continue;
        for (let c = range.startCol; c <= range.endCol; c++) {
          if (out[c] === null) out[c] = d.id;
        }
      }
      cache.set(geneId, out);
      return out;
    };
  }, [msa, data.proteinDomains, colByResidue]);

  // Per-internal-node domain stats — the ancestral propagation. For any
  // node id (typically a collapsed-summary's id), returns the dominant
  // domain id and per-column coverage *within that node's subtree*, both
  // arrays length msa.length. Cached identically to consensusByNode and
  // invalidated on the same key.
  const domainStatsByNode = useMemo(() => {
    const cache = new Map<
      NodeId,
      { dominant: (string | null)[]; coverage: number[] }
    >();
    return (
      rootId: NodeId,
    ): { dominant: (string | null)[]; coverage: number[] } | null => {
      if (!msa) return null;
      const cached = cache.get(rootId);
      if (cached) return cached;
      const ids = leafGeneIdsByNode(rootId);
      if (ids.length === 0) return null;
      const dominant = computeDominantDomainByCol(
        msa,
        data.proteinDomains,
        new Set(ids),
      );
      const coverage = computeCoverageArray(ids, msa.sequences, msa.length);
      const stats = { dominant, coverage };
      cache.set(rootId, stats);
      return stats;
    };
  }, [msa, data.proteinDomains, leafGeneIdsByNode]);

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
    nodeId: NodeId;
    /** Alpha applied to the bar's domain colour. Leaf bars are full-alpha;
     *  collapsed-summary bars use the run's peak coverage so a partly-
     *  conserved domain on a clade fades the same way as the minimap. */
    alpha: number;
  };
  const domainBars = useMemo<DomainBar[]>(() => {
    if (!msa || !mask) return [];
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
      if (r.kind === 'leaf') {
        // Per-leaf bars: each ProteinDomain hit is rendered as one bar
        // (split where masking interrupts the column run). Always full
        // alpha — a leaf either has a domain at a column or it doesn't.
        const node = data.tree.nodes[r.nodeId];
        if (!node?.geneId) continue;
        const domains = data.proteinDomains?.[node.geneId];
        if (!domains?.length) continue;
        const map = colByResidue(node.geneId);
        for (const d of domains) {
          const range = domainColumnRange(d, map);
          if (!range) continue;
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
                  nodeId: r.nodeId,
                  alpha: 1,
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
              nodeId: r.nodeId,
              alpha: 1,
            });
          }
        }
      } else if (r.kind === 'collapsedSummary') {
        // Internal-node bars: the dominant-domain map per column is
        // already aggregated across descendants. Walk visible cols, emit
        // one bar per contiguous run of the same dominant id, alpha =
        // peak subtree coverage in the run.
        const stats = domainStatsByNode(r.nodeId);
        if (!stats) continue;
        let runStart = -1;
        let runDom: string | null = null;
        let runMaxCov = 0;
        const flush = (endVCol: number) => {
          if (runStart < 0 || !runDom) return;
          bars.push({
            key: `${r.nodeId}:${runDom}:${runStart}`,
            rowY: r.y,
            rowH: r.height,
            startVCol: runStart,
            endVCol,
            id: runDom,
            nodeId: r.nodeId,
            alpha: runMaxCov,
          });
          runStart = -1;
          runDom = null;
          runMaxCov = 0;
        };
        for (let vCol = 0; vCol < mask.visibleCols.length; vCol++) {
          const oCol = mask.visibleCols[vCol];
          const did = stats.dominant[oCol] ?? null;
          if (did !== runDom) {
            flush(vCol - 1);
            if (did) {
              runStart = vCol;
              runDom = did;
              runMaxCov = stats.coverage[oCol] ?? 0;
            }
          } else if (did) {
            const cov = stats.coverage[oCol] ?? 0;
            if (cov > runMaxCov) runMaxCov = cov;
          }
        }
        flush(mask.visibleCols.length - 1);
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
    domainStatsByNode,
  ]);

  // Splice-junction marks: a thin vertical line at a fractional position
  // within an MSA column, per visible leaf row.
  //
  // Junction values are 1-based residue (amino-acid) positions and may be
  // fractional. Integer J lands at the right edge of residue J's column
  // (e.g. 2.0 = between residues 2 and 3). Fractional J represents a
  // junction WITHIN a codon at fraction `J - floor(J)` through residue
  // `floor(J)+1`'s column — host code can divide CDS-nucleotide
  // coordinates by 3 (e.g. nt 6/7/8 → 2.000 / 2.333 / 2.666) to pinpoint
  // the within-codon offset of an intron boundary.
  //
  // Translation through the leaf's colByResidue map handles MSA gaps.
  // Junctions whose target column is masked are skipped silently — no
  // usable position to anchor against.
  type JunctionMark = {
    key: string;
    rowY: number;
    rowH: number;
    /** Visible-col index of the residue whose column the junction sits in. */
    vCol: number;
    /** Fraction across the column (0 = left edge, 1 = right edge). */
    withinFrac: number;
  };
  const junctionMarks = useMemo<JunctionMark[]>(() => {
    if (!msa || !mask || !data.exonJunctions) return [];
    const visibleByOriginal = new Map<number, number>();
    for (let i = 0; i < mask.visibleCols.length; i++) {
      visibleByOriginal.set(mask.visibleCols[i], i);
    }
    const out: JunctionMark[] = [];
    const startIdx = rowRange.startIndex;
    const endIdx = Math.min(rowRange.endIndex, visibleRows.length);
    for (let i = startIdx; i < endIdx; i++) {
      const r = visibleRows[i];
      if (r.kind !== 'leaf') continue;
      const node = data.tree.nodes[r.nodeId];
      if (!node?.geneId) continue;
      const junctions = data.exonJunctions[node.geneId];
      if (!junctions || junctions.length === 0) continue;
      const map = colByResidue(node.geneId);
      const lastResidue = map.length - 1;
      if (lastResidue <= 0) continue;
      for (const j of junctions) {
        if (!Number.isFinite(j) || j <= 0) continue;
        const intPart = Math.floor(j);
        const frac = j - intPart;
        let residueIdx: number;
        let withinFrac: number;
        if (frac === 0) {
          // Boundary at right edge of residue `intPart`.
          if (intPart < 1 || intPart > lastResidue) continue;
          residueIdx = intPart;
          withinFrac = 1;
        } else {
          // Inside residue `intPart + 1`'s codon, `frac` fraction in.
          const nextRes = intPart + 1;
          if (nextRes < 1 || nextRes > lastResidue) continue;
          residueIdx = nextRes;
          withinFrac = frac;
        }
        const oCol = map[residueIdx];
        const vCol = visibleByOriginal.get(oCol);
        if (vCol === undefined) continue;
        out.push({
          key: `${r.nodeId}:${j}`,
          rowY: r.y,
          rowH: r.height,
          vCol,
          withinFrac,
        });
      }
    }
    return out;
  }, [
    msa,
    mask,
    data.exonJunctions,
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
  type DomainTipEntry = {
    domain: ProteinDomain;
    /** Set when the click resolved to a collapsed-summary (i.e. an
     *  internal-node) row: count of leaves WITHIN that subtree which
     *  carry this domain at the clicked column. */
    subtreeCount?: number;
  };
  type DomainTip = {
    screenX: number;
    screenY: number;
    title: string;
    entries: DomainTipEntry[];
    /** Total leaf count of the subtree (denominator for subtreeCount).
     *  Absent for leaf-scope clicks. */
    subtreeTotal?: number;
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
    // "Plain" / "Domains" scheme: each row gets its OWN colour source —
    // leaves colour by the leaf's own domain hits (full alpha), collapsed
    // summaries colour by their subtree's dominant domain × subtree
    // coverage (so a partly-conserved domain on a collapsed clade fades
    // exactly the same way as in the minimap header). Other schemes use
    // the standard residue → colour map and pay no extra cost.
    //
    // Auto-override: when the user is zoomed out far enough that residue
    // colours stop reading (residueWidth < AUTO_DOMAIN_RESIDUE_PX) AND the
    // host has supplied domain data, force-switch to domain colouring.
    // The user's `colorSchemeId` is left alone — only the render is
    // overridden — so zooming back in restores Clustal/etc.
    const hasDomains =
      !!data.proteinDomains && Object.keys(data.proteinDomains).length > 0;
    const usePlainDomains =
      scheme.id === 'plain' ||
      (residueWidth < AUTO_DOMAIN_RESIDUE_PX && hasDomains);

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
      // Domain colour source for the "Plain" / "Domains" scheme — set up
      // per row so leaves and collapsed summaries can use different
      // logic. Returns the CSS colour string or null when there's no
      // domain at the given column on this row.
      let domainColorAt: ((oCol: number) => string | null) | null = null;
      if (r.kind === 'leaf') {
        const node = data.tree.nodes[r.nodeId];
        const geneId = node?.geneId;
        const seq = geneId ? msa.sequences[geneId] : undefined;
        if (seq) getCh = (col) => seq[col];
        if (usePlainDomains && geneId) {
          const dByCol = domainByColForLeaf(geneId);
          if (dByCol) domainColorAt = (oCol) => {
            const did = dByCol[oCol];
            return did ? domainColor(did) : null;
          };
        }
      } else if (r.kind === 'collapsedSummary') {
        const arr = consensusByNode(r.nodeId);
        if (arr) {
          getCh = (col) => arr[col] ?? undefined;
          consensusRow = true;
        }
        if (usePlainDomains) {
          const stats = domainStatsByNode(r.nodeId);
          if (stats) domainColorAt = (oCol) => {
            const did = stats.dominant[oCol];
            if (!did) return null;
            const cov = Math.max(0, Math.min(1, stats.coverage[oCol] ?? 1));
            return domainColor(did, cov);
          };
        }
      }
      if (!getCh) continue;
      const colorAt = (oCol: number, ch: string): string | null => {
        if (usePlainDomains) return domainColorAt ? domainColorAt(oCol) : null;
        return scheme.color(ch);
      };

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
    domainByColForLeaf,
    domainStatsByNode,
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
      <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--tbrowse-text-muted)' }}>
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

  // Body click → if a row + column intersection has any domain hits
  // overlapping, open the domain tooltip. Leaf rows show their own hits;
  // collapsed-summary rows aggregate domain hits across the descendant
  // leaves of that internal node. Either way, this does NOT call
  // onSelectNode — node selection lives in the tree zone.
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
    if (!row) return;
    const node = data.tree.nodes[row.nodeId];
    if (!node) return;

    if (row.kind === 'leaf') {
      if (!node.geneId) return;
      const hits = data.proteinDomains?.[node.geneId];
      if (!hits || hits.length === 0) return;
      const map = colByResidue(node.geneId);
      const overlapping = hits.filter((d) => {
        const range = domainColumnRange(d, map);
        return range !== null && oCol >= range.startCol && oCol <= range.endCol;
      });
      if (overlapping.length === 0) return;
      const displayName =
        (data.geneMetadata?.[node.geneId] as { displayName?: string } | undefined)
          ?.displayName ?? node.geneId;
      setDomainTip({
        screenX: e.clientX,
        screenY: e.clientY,
        title: displayName,
        entries: overlapping.map((d) => ({ domain: d })),
      });
      return;
    }

    if (row.kind === 'collapsedSummary') {
      const ids = leafGeneIdsByNode(row.nodeId);
      if (ids.length === 0) return;
      // Aggregate domains across the subtree at the clicked column. For
      // each domain id, record one representative ProteinDomain (the
      // first leaf hit we encounter — names/sources are typically the
      // same across leaves of the same family) and how many subtree
      // leaves carry that hit at this column.
      const byId = new Map<
        string,
        { domain: ProteinDomain; count: number }
      >();
      for (const gid of ids) {
        const hits = data.proteinDomains?.[gid];
        if (!hits || hits.length === 0) continue;
        const map = colByResidue(gid);
        const seen = new Set<string>();
        for (const d of hits) {
          if (seen.has(d.id)) continue;
          const range = domainColumnRange(d, map);
          if (!range || oCol < range.startCol || oCol > range.endCol) continue;
          seen.add(d.id);
          const cur = byId.get(d.id);
          if (cur) cur.count++;
          else byId.set(d.id, { domain: d, count: 1 });
        }
      }
      if (byId.size === 0) return;
      const entries: DomainTipEntry[] = [...byId.values()]
        .sort((a, b) => b.count - a.count)
        .map(({ domain, count }) => ({ domain, subtreeCount: count }));

      // Title: prefer taxonomy when known so the user sees "(N) Genus"
      // instead of just a leaf count.
      let title = `(${row.leafCount} leaves)`;
      if (node.taxonomyId !== undefined && data.taxonomy?.[node.taxonomyId]) {
        const tax = data.taxonomy[node.taxonomyId];
        const taxName = tax.scientificName ?? tax.commonName;
        if (taxName) title = `(${row.leafCount}) ${taxName}`;
      }

      setDomainTip({
        screenX: e.clientX,
        screenY: e.clientY,
        title,
        entries,
        subtreeTotal: ids.length,
      });
    }
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
                ? 'var(--tbrowse-row-select-bg)'
                : isExactHover
                  ? 'var(--tbrowse-row-hover-bg)'
                  : isInHoveredSubtree
                    ? 'var(--tbrowse-row-subtree-bg)'
                    : 'transparent',
              borderBottom: '1px solid var(--tbrowse-border-row)',
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
            // Intentionally no z-index. Document order already puts this
            // above the canvas + row-hit divs; setting z-index: 1 here
            // would lift the SVG into the root stacking context and let
            // it paint over the sticky zone header during scroll.
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
                fill={domainColor(b.id, b.alpha)}
                pointerEvents="none"
              />
            );
          })}
        </svg>
      )}
      {/* Splice-junction marks: thin vertical line at the right edge of
          the junction column, full row height. Drawn AFTER domain bars
          so the bar's colour shows through underneath the line. */}
      {junctionMarks.length > 0 && vpForOverlay && (
        <svg
          width={width}
          height={totalHeight}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            pointerEvents: 'none',
          }}
        >
          {junctionMarks.map((m) => {
            const x =
              PAD_X +
              (m.vCol - vpForOverlay.start + m.withinFrac) * overlayResidueWidth;
            if (x <= PAD_X || x >= PAD_X + innerWidthForOverlay) return null;
            return (
              <line
                key={m.key}
                x1={x}
                y1={m.rowY}
                x2={x}
                y2={m.rowY + m.rowH}
                stroke="red"
                strokeWidth={1}
                strokeOpacity={0.55}
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
            // Intentionally no z-index — see the domain-bar SVG comment
            // above. Document order keeps these mask markers on top of
            // the domain bars without escaping the body's stacking
            // context.
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
 * (row, column) intersection.
 *
 * - Leaf-scope clicks: each entry shows the leaf's specific residue range.
 * - Subtree-scope clicks (collapsed-summary rows): each entry shows how
 *   many leaves of the subtree carry the domain at the clicked column.
 *
 * Both scopes also surface the tree-wide frequency for context. Closed on
 * outside click or Escape (Escape handled by the parent body).
 */
function DomainTooltip({
  tip,
  stats,
  onClose,
}: {
  tip: {
    screenX: number;
    screenY: number;
    title: string;
    entries: Array<{ domain: ProteinDomain; subtreeCount?: number }>;
    subtreeTotal?: number;
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
  const estH = 24 + tip.entries.length * 36;
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
        background: 'var(--tbrowse-bg-elevated)',
        border: '1px solid var(--tbrowse-border)',
        borderRadius: 6,
        boxShadow: '0 4px 12px var(--tbrowse-tooltip-shadow)',
        padding: '8px 10px',
        fontSize: 12,
        color: 'var(--tbrowse-text)',
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
        <div style={{ fontWeight: 600 }}>{tip.title}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--tbrowse-text-muted)',
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
        {tip.entries.map(({ domain: d, subtreeCount }) => {
          const seenIn = stats.freq.get(d.id) ?? 0;
          const total = stats.totalLeaves;
          const pct = total > 0 ? Math.round((seenIn / total) * 100) : 0;
          const isSubtree = subtreeCount !== undefined && tip.subtreeTotal !== undefined;
          const subPct =
            isSubtree && tip.subtreeTotal! > 0
              ? Math.round((subtreeCount! / tip.subtreeTotal!) * 100)
              : 0;
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
                <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
                  {d.id}
                  {d.source ? ` · ${d.source}` : ''}
                  {!isSubtree && ` · residues ${d.start}–${d.end}`}
                </div>
                {isSubtree && (
                  <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
                    in {subtreeCount} / {tip.subtreeTotal} subtree leaves ({subPct}%)
                  </div>
                )}
                <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
                  tree-wide: {seenIn} / {total} leaves ({pct}%)
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
  defaultWidth: 50,
  minWidth: 120,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) => Boolean(data.msa),
};

// Helpers referenced from sibling files in later slices (minimap, pan/zoom).
export { resolveViewport };
export type { ResolvedViewport };
