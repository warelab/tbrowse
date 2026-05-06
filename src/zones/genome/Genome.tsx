import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GeneStructure,
  GenomeFeature,
  HostData,
  NodeId,
  Transcript,
  ZoneDefinition,
  ZoneRenderProps,
} from '../../types';
import {
  buildRowLayout,
  COMPRESSED_INTRON_NT,
  pickCanonicalTranscript,
  type RowLayout,
} from './layout';

/** Padding either side of the row's drawing area. */
const PAD_X = 4;
/** Width reserved on the left for the strand indicator. */
const INDICATOR_WIDTH = 16;
/** Vertical padding inside each row so boxes don't touch row borders. */
const ROW_VPAD = 4;
/** UTR shoulder height fraction relative to CDS box height. */
const UTR_FRAC = 0.5;

const FEATURE_COLORS: Record<string, string> = {
  TFBS: 'hsl(280 60% 55%)',
  enhancer: 'hsl(35 75% 55%)',
  CpG: 'hsl(195 60% 50%)',
  repeat: 'hsl(0 0% 60%)',
};

function featureColor(f: GenomeFeature): string {
  const key = f.category ?? f.kind;
  return FEATURE_COLORS[key] ?? `hsl(${stableHash(key) % 360} 55% 55%)`;
}

function stableHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export interface GenomeZoneState {
  paddingMode: 'cds' | 'gene' | 'kb';
  paddingKb: number;
  compressIntrons: boolean;
  /** Per-(row, intron) override keys — XOR with `compressIntrons`. */
  intronOverrideKeys: string[];
  /** Per-row strand-flip override; XOR with strand-driven auto-flip. */
  flippedNodeIds: NodeId[];
  /** Genome feature kinds to render; null = all. */
  visibleFeatureKinds: string[] | null;
  /** Horizontal pan in pixels — set by drag, reset by the "fit" button. */
  panPx: number;
}

const DEFAULT_STATE: GenomeZoneState = {
  paddingMode: 'gene',
  paddingKb: 2,
  compressIntrons: true,
  intronOverrideKeys: [],
  flippedNodeIds: [],
  visibleFeatureKinds: null,
  panPx: 0,
};

export interface CreateGenomeZoneOptions {
  id: string;
  displayName?: string;
  defaultWidth?: number;
  initial?: Partial<GenomeZoneState>;
}

interface RowCandidate {
  geneStructure: GeneStructure;
  transcript: Transcript;
  layout: RowLayout;
  /** Combined auto + user flip — drives the rendered orientation. */
  flipped: boolean;
  /** True only when the user has explicitly toggled this row's strand
   *  away from its automatic display. Drives the +/- glyph so the
   *  indicator reflects the natural strand by default. */
  userFlipped: boolean;
  /** Eff-coord shift applied to this row's display so its first MSA
   *  position shared with the NoI aligns horizontally with the NoI's
   *  residue at that column. Zero for the NoI itself and for rows
   *  without an MSA-driven anchor. Uses the simple `(M-N)*3` rule —
   *  ignores intron-eff costs in the first N codons of either gene. */
  shiftEff: number;
  /** Eff coord at which to draw the per-row "anchor" tick — the gene's
   *  genomic position corresponding to the first shared MSA column
   *  with the NoI. Falls back to the start codon (or `effMin` for
   *  non-coding rows) when no shared column exists. */
  anchorEff: number;
}

const GAP_DASH = '-';
const GAP_DOT = '.';
function isGap(ch: string): boolean {
  return ch === GAP_DASH || ch === GAP_DOT;
}

/** Count non-gap characters in `seq[0..col]` (inclusive). 1-based result. */
function peptidePosAt(seq: string, col: number): number {
  let n = 0;
  const upto = Math.min(col, seq.length - 1);
  for (let i = 0; i <= upto; i++) if (!isGap(seq[i])) n++;
  return n;
}

/**
 * Find the first MSA column ≥ the gene's first non-gap column where
 * BOTH the gene and the NoI carry a residue. Returns -1 if no such
 * column exists (e.g. the gene's residues never overlap any of the
 * NoI's residues — happens occasionally when one of the sequences is
 * truncated). Pure helper used to compute the per-row alignment shift.
 */
function firstSharedAaCol(geneSeq: string, noiSeq: string): number {
  const len = Math.min(geneSeq.length, noiSeq.length);
  let geneFirst = -1;
  for (let c = 0; c < len; c++) {
    if (!isGap(geneSeq[c])) {
      geneFirst = c;
      break;
    }
  }
  if (geneFirst < 0) return -1;
  for (let c = geneFirst; c < len; c++) {
    if (!isGap(geneSeq[c]) && !isGap(noiSeq[c])) return c;
  }
  return -1;
}

/**
 * Compute a single `pxPerEff` plus a global start-codon pixel anchor so
 * that every coding row's start codon lands at the same x. Non-coding
 * rows are treated as if their start codon sat at `effMin`. The scale
 * is chosen so the longest 5'-side and longest 3'-side both fit in the
 * drawing area at the chosen rate.
 *
 * Returns `null` when no row layout exists yet.
 */
function computeGlobalScale(
  candidates: RowCandidate[],
  drawingWidth: number,
): { pxPerEff: number; startCodonPx: number } | null {
  if (candidates.length === 0) return null;
  let max5 = 0;
  let max3 = 0;
  for (const c of candidates) {
    const { layout, flipped } = c;
    const startEff = layout.startCodonEff ?? layout.effMin;
    // 5' side eff distance and 3' side eff distance, accounting for
    // the visual flip on reverse-strand rows.
    const lowSide = startEff - layout.effMin;
    const highSide = layout.effMax - startEff;
    const fivePrime = flipped ? highSide : lowSide;
    const threePrime = flipped ? lowSide : highSide;
    if (fivePrime > max5) max5 = fivePrime;
    if (threePrime > max3) max3 = threePrime;
  }
  const totalEff = Math.max(1, max5 + max3);
  const pxPerEff = drawingWidth / totalEff;
  const startCodonPx = max5 * pxPerEff;
  return { pxPerEff, startCodonPx };
}

export function createGenomeZone(
  opts: CreateGenomeZoneOptions,
): ZoneDefinition<GenomeZoneState> {
  const displayName = opts.displayName ?? 'Genome';
  const defaultWidth = opts.defaultWidth ?? 32;
  const initialState: GenomeZoneState = { ...DEFAULT_STATE, ...opts.initial };

  const Header = (props: ZoneRenderProps<GenomeZoneState>) => {
    const { zoneState, setZoneState, hoveredNodeId, data, width } = props;
    const state = zoneState ?? initialState;
    const setMode = (mode: GenomeZoneState['paddingMode']) =>
      setZoneState((s) => ({ ...(s ?? initialState), paddingMode: mode }));
    const toggleCompress = () =>
      setZoneState((s) => ({
        ...(s ?? initialState),
        compressIntrons: !(s ?? initialState).compressIntrons,
      }));
    const hoveredInfo = (() => {
      if (!hoveredNodeId) return null;
      const node = data.tree.nodes[hoveredNodeId];
      if (!node?.geneId) return null;
      const gs = data.geneStructures?.[node.geneId];
      if (!gs) return null;
      const strandSign = gs.strand === -1 ? '−' : '+';
      const tax = node.taxonomyId ? data.taxonomy?.[node.taxonomyId] : undefined;
      const taxName = tax?.scientificName ?? tax?.commonName;
      const transcriptCount = gs.transcripts.length;
      const parts: string[] = [];
      if (taxName) parts.push(taxName);
      if (gs.name) parts.push(gs.name);
      parts.push(
        `${gs.region}:${gs.start.toLocaleString()}–${gs.end.toLocaleString()} (${strandSign})`,
      );
      parts.push(
        `${transcriptCount} transcript${transcriptCount === 1 ? '' : 's'}`,
      );
      return parts.join(' · ');
    })();

    const btnStyle = (active: boolean) => ({
      fontSize: 11,
      padding: '1px 6px',
      border: `1px solid ${active ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
      background: active ? 'var(--tbrowse-accent-soft)' : 'var(--tbrowse-bg-input)',
      color: active ? 'var(--tbrowse-accent-strong)' : 'var(--tbrowse-text)',
      borderRadius: 3,
      cursor: 'pointer',
    });

    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 13,
          color: 'var(--tbrowse-text)',
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '0 10px 0 14px',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontWeight: 600 }}>{displayName}</span>
          <span
            style={{
              fontWeight: 400,
              color: 'var(--tbrowse-text-muted)',
              fontSize: 11,
            }}
          >
            {width.toFixed(0)}px
          </span>
          <button
            type="button"
            onClick={() => setMode('cds')}
            style={btnStyle(state.paddingMode === 'cds')}
            title="Window covers the CDS only"
          >
            CDS
          </button>
          <button
            type="button"
            onClick={() => setMode('gene')}
            style={btnStyle(state.paddingMode === 'gene')}
            title="Window covers the full gene span (UTRs included)"
          >
            Gene
          </button>
          <button
            type="button"
            onClick={() => setMode('kb')}
            style={btnStyle(state.paddingMode === 'kb')}
            title={`Window covers gene span ± ${state.paddingKb} kb`}
          >
            ±{state.paddingKb}kb
          </button>
          <button
            type="button"
            onClick={toggleCompress}
            style={btnStyle(state.compressIntrons)}
            title={
              state.compressIntrons
                ? 'Long introns compressed — click to expand all'
                : 'Long introns expanded — click to compress all'
            }
          >
            //
          </button>
          <button
            type="button"
            onClick={() =>
              setZoneState((s) => ({ ...(s ?? initialState), panPx: 0 }))
            }
            disabled={(state.panPx ?? 0) === 0}
            style={{
              ...btnStyle((state.panPx ?? 0) !== 0),
              opacity: (state.panPx ?? 0) === 0 ? 0.5 : 1,
            }}
            title="Reset pan"
          >
            fit
          </button>
        </div>
        <div
          style={{
            flex: '0 0 18px',
            minHeight: 0,
            padding: '0 10px 0 14px',
            display: 'flex',
            alignItems: 'center',
            fontSize: 11,
            color: 'var(--tbrowse-text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={hoveredInfo ?? ''}
        >
          {hoveredInfo ?? (
            <span style={{ color: 'var(--tbrowse-text-subtle)' }}>
              hover a row…
            </span>
          )}
        </div>
      </div>
    );
  };

  const Body = (props: ZoneRenderProps<GenomeZoneState>) => {
    const {
      visibleRows,
      rowRange,
      width,
      data,
      hoveredNodeId,
      hoveredSubtreeIds,
      selectedNodeId,
      onHoverNode,
      zoneState,
      setZoneState,
    } = props;
    const state = zoneState ?? initialState;

    const containerRef = useRef<HTMLDivElement>(null);
    const overrideSet = useMemo(
      () => new Set(state.intronOverrideKeys),
      [state.intronOverrideKeys],
    );
    const flippedSet = useMemo(
      () => new Set(state.flippedNodeIds),
      [state.flippedNodeIds],
    );

    const drawingX = PAD_X + INDICATOR_WIDTH;
    const drawingWidth = Math.max(1, width - 2 * PAD_X - INDICATOR_WIDTH);

    const totalHeight = useMemo(
      () =>
        visibleRows.length > 0
          ? visibleRows[visibleRows.length - 1].y +
            visibleRows[visibleRows.length - 1].height
          : 0,
      [visibleRows],
    );

    const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

    // NoI sequence (when both an NoI is set and an MSA is present) drives
    // the per-row alignment shift. Resolved once so each row's
    // sharedCol calc reads from a stable string.
    const noiGeneId = useMemo<string | null>(() => {
      const id = props.nodeOfInterestId;
      if (!id) return null;
      return data.tree.nodes[id]?.geneId ?? null;
    }, [props.nodeOfInterestId, data.tree.nodes]);
    const noiSeq = useMemo<string | null>(() => {
      if (!data.msa || !noiGeneId) return null;
      return data.msa.sequences[noiGeneId] ?? null;
    }, [data.msa, noiGeneId]);

    // Per-row candidate layouts keyed by node id. Built once for the visible
    // slice so the global-scale pass can read max 5'/3' extents without
    // re-computing.
    const candidates = useMemo(() => {
      const map = new Map<NodeId, RowCandidate>();
      for (const r of rows) {
        if (r.kind !== 'leaf') continue;
        const node = data.tree.nodes[r.nodeId];
        if (!node?.geneId) continue;
        const gs = data.geneStructures?.[node.geneId];
        if (!gs) continue;
        const transcript = pickCanonicalTranscript(gs);
        if (!transcript) continue;
        const layout = buildRowLayout({
          geneStructure: gs,
          transcript,
          paddingMode: state.paddingMode,
          paddingKb: state.paddingKb,
          overrideKeys: overrideSet,
          compressDefault: state.compressIntrons,
          rowKey: r.nodeId,
        });
        const autoFlip = gs.strand === -1;
        const userFlipped = flippedSet.has(r.nodeId);
        const flipped = autoFlip !== userFlipped;

        // MSA-driven alignment: shift this row so its first shared MSA
        // residue with the NoI lines up at NoI's residue at that column.
        // The simple shift = 3 * (M - N) — the eff-distance approximation
        // ignores introns within the first N codons but stays correct
        // when both genes have similar intron structure (the typical
        // case). The anchor tick is drawn at gene's peptide pos N's
        // genomic coord, which is close to start codon ± 3*(N-1) in eff
        // for short, intron-free 5' segments.
        const startEff = layout.startCodonEff ?? layout.effMin;
        let shiftEff = 0;
        let anchorEff = startEff;
        const geneSeq = data.msa?.sequences[node.geneId];
        if (
          noiSeq &&
          geneSeq &&
          noiGeneId !== null &&
          node.geneId !== noiGeneId
        ) {
          const colShared = firstSharedAaCol(geneSeq, noiSeq);
          if (colShared >= 0) {
            const N = peptidePosAt(geneSeq, colShared);
            const M = peptidePosAt(noiSeq, colShared);
            shiftEff = 3 * (M - N);
            // Eff coord of gene's peptide pos N (first nt of codon N).
            // On + strand the genomic coord increases with peptide pos;
            // on - strand it decreases. Eff is genomic-ascending so we
            // translate accordingly. Approximation: assumes the first N
            // codons sit in CDS-only territory (no compressed-intron
            // step before them).
            const offset = 3 * (N - 1);
            anchorEff =
              gs.strand === 1 ? startEff + offset : startEff - offset;
          }
        }

        map.set(r.nodeId, {
          geneStructure: gs,
          transcript,
          layout,
          flipped,
          userFlipped,
          shiftEff,
          anchorEff,
        });
      }
      return map;
    }, [
      rows,
      data.tree.nodes,
      data.geneStructures,
      data.msa,
      noiGeneId,
      noiSeq,
      state.paddingMode,
      state.paddingKb,
      state.compressIntrons,
      overrideSet,
      flippedSet,
    ]);

    const scale = useMemo(
      () => computeGlobalScale([...candidates.values()], drawingWidth),
      [candidates, drawingWidth],
    );

    // Mouse-drag panning. Tracks document-level mousemove/mouseup so
    // dragging past the zone edges keeps panning instead of stalling.
    // Movement under DRAG_THRESHOLD px is ignored so a brief click
    // continues to land cleanly on the underlying exon / intron toggle.
    const DRAG_THRESHOLD = 4;
    const dragRef = useRef<{
      startX: number;
      startPan: number;
      engaged: boolean;
    } | null>(null);
    const onMouseDownPan = (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragRef.current = {
        startX: e.clientX,
        startPan: state.panPx ?? 0,
        engaged: false,
      };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        if (!dragRef.current.engaged) {
          if (Math.abs(dx) < DRAG_THRESHOLD) return;
          dragRef.current.engaged = true;
        }
        setZoneState((s) => ({
          ...(s ?? initialState),
          panPx: dragRef.current!.startPan + dx,
        }));
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };

    const toggleIntron = (key: string) => {
      setZoneState((s) => {
        const cur = (s ?? initialState).intronOverrideKeys;
        const idx = cur.indexOf(key);
        const next = idx >= 0 ? cur.filter((x) => x !== key) : [...cur, key];
        return { ...(s ?? initialState), intronOverrideKeys: next };
      });
    };
    const toggleFlip = (nodeId: NodeId) => {
      setZoneState((s) => {
        const cur = (s ?? initialState).flippedNodeIds;
        const idx = cur.indexOf(nodeId);
        const next = idx >= 0 ? cur.filter((x) => x !== nodeId) : [...cur, nodeId];
        return { ...(s ?? initialState), flippedNodeIds: next };
      });
    };

    type Tip = {
      screenX: number;
      screenY: number;
      title: string;
      lines: string[];
    };
    const [tip, setTip] = useState<Tip | null>(null);
    useEffect(() => {
      if (!tip) return;
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setTip(null);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [tip]);

    const indicatorCx = PAD_X + INDICATOR_WIDTH / 2;

    return (
      <>
        <div
          ref={containerRef}
          onMouseDown={onMouseDownPan}
          style={{
            position: 'relative',
            width,
            height: totalHeight,
            overflow: 'hidden',
            cursor: dragRef.current ? 'grabbing' : 'grab',
          }}
        >
        <svg
          width={width}
          height={totalHeight}
          style={{ display: 'block', shapeRendering: 'crispEdges' }}
        >
          {rows.map((r) => {
            if (r.kind !== 'leaf') return null;
            const node = data.tree.nodes[r.nodeId];
            if (!node?.geneId) return null;
            const candidate = candidates.get(r.nodeId);
            const isExactHover = hoveredNodeId === r.nodeId;
            const isInHoveredSubtree = hoveredSubtreeIds.has(r.nodeId);
            const isSelected = selectedNodeId === r.nodeId;
            const rowBg = isSelected
              ? 'var(--tbrowse-row-select-bg)'
              : isExactHover
                ? 'var(--tbrowse-row-hover-bg)'
                : isInHoveredSubtree
                  ? 'var(--tbrowse-row-subtree-bg)'
                  : null;

            const opacity = r.opacity ?? 1;
            const rowH = r.height - ROW_VPAD * 2;
            const rowY = r.y + ROW_VPAD;
            const midY = rowY + rowH / 2;

            return (
              <g
                key={`row-${r.nodeId}`}
                opacity={opacity}
                onMouseEnter={() => onHoverNode(r.nodeId)}
                onMouseLeave={() => onHoverNode(null)}
              >
                {rowBg && (
                  <rect
                    x={0}
                    y={r.y}
                    width={width}
                    height={r.height}
                    fill={rowBg}
                  />
                )}
                {candidate &&
                  renderRow({
                    candidate,
                    nodeId: r.nodeId,
                    geneId: node.geneId,
                    drawingX,
                    drawingWidth,
                    rowY,
                    rowH,
                    midY,
                    indicatorCx,
                    indicatorY: r.y,
                    indicatorH: r.height,
                    scale,
                    panPx: state.panPx ?? 0,
                    shiftEff: candidate.shiftEff,
                    anchorEff: candidate.anchorEff,
                    state,
                    data,
                    onToggleIntron: toggleIntron,
                    onToggleFlip: toggleFlip,
                    onTip: setTip,
                  })}
                {!candidate && (
                  <text
                    x={drawingX + drawingWidth / 2}
                    y={midY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={11}
                    fill="var(--tbrowse-text-subtle)"
                    pointerEvents="none"
                  >
                    no gene structure
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        </div>
        {tip && <GenomeTooltip tip={tip} onClose={() => setTip(null)} />}
      </>
    );
  };

  return {
    id: opts.id,
    displayName,
    Header,
    Body,
    defaultWidth,
    minWidth: 200,
    defaultZoneState: initialState,
    isAvailable: (data) =>
      Boolean(
        data.geneStructures && Object.keys(data.geneStructures).length > 0,
      ),
    defaultVisible: false,
  };
}

interface RenderRowArgs {
  candidate: RowCandidate;
  nodeId: NodeId;
  geneId: string;
  drawingX: number;
  drawingWidth: number;
  rowY: number;
  rowH: number;
  midY: number;
  indicatorCx: number;
  indicatorY: number;
  indicatorH: number;
  scale: { pxPerEff: number; startCodonPx: number } | null;
  panPx: number;
  shiftEff: number;
  anchorEff: number;
  state: GenomeZoneState;
  data: HostData;
  onToggleIntron: (key: string) => void;
  onToggleFlip: (nodeId: NodeId) => void;
  onTip: (
    t: {
      screenX: number;
      screenY: number;
      title: string;
      lines: string[];
    } | null,
  ) => void;
}

function renderRow(args: RenderRowArgs): JSX.Element {
  const {
    candidate,
    nodeId,
    geneId,
    drawingX,
    drawingWidth,
    rowY,
    rowH,
    midY,
    indicatorCx,
    indicatorY,
    indicatorH,
    scale,
    state,
    data,
    onToggleIntron,
    onToggleFlip,
    onTip,
  } = args;
  const { layout, flipped, userFlipped, geneStructure, transcript } = candidate;

  const startEff = layout.startCodonEff ?? layout.effMin;
  let pxPerEff: number;
  let startPx: number;
  if (scale) {
    pxPerEff = scale.pxPerEff;
    startPx =
      drawingX + scale.startCodonPx + args.panPx + args.shiftEff * scale.pxPerEff;
  } else {
    const span = Math.max(1, layout.effMax - layout.effMin);
    pxPerEff = drawingWidth / span;
    startPx =
      drawingX +
      (startEff - layout.effMin) * pxPerEff +
      args.panPx +
      args.shiftEff * pxPerEff;
  }

  const effToPx = (eff: number): number =>
    flipped
      ? startPx - (eff - startEff) * pxPerEff
      : startPx + (eff - startEff) * pxPerEff;

  const cdsH = rowH;
  const utrH = Math.max(2, rowH * UTR_FRAC);
  const cdsY = rowY;
  const utrY = rowY + (rowH - utrH) / 2;

  const elements: JSX.Element[] = [];

  // Baseline.
  elements.push(
    <line
      key="baseline"
      x1={drawingX}
      y1={midY}
      x2={drawingX + drawingWidth}
      y2={midY}
      stroke="var(--tbrowse-text-subtle)"
      strokeOpacity={0.25}
      strokeWidth={0.75}
      pointerEvents="none"
    />,
  );

  // Per-row anchor tick — marks the genomic coord that lines up with the
  // NoI in the MSA. For the NoI itself this is its start codon; for
  // every other row it's the gene's residue at the first MSA column the
  // gene shares with the NoI. The tick is what visually "ties" each
  // gene to the NoI's coordinate system.
  if (layout.startCodonEff !== undefined) {
    const anchorPx = effToPx(args.anchorEff);
    elements.push(
      <line
        key="anchor"
        x1={anchorPx}
        y1={rowY - 1}
        x2={anchorPx}
        y2={rowY + rowH + 1}
        stroke="var(--tbrowse-accent)"
        strokeOpacity={0.55}
        strokeWidth={1}
        pointerEvents="none"
      />,
    );
  }

  // Genome features track — drawn slightly below the baseline as small bars.
  const features = data.genomeFeatures?.[geneId];
  if (features && features.length > 0) {
    const visibleKinds = state.visibleFeatureKinds;
    const featY = rowY + rowH + 1;
    const featH = Math.max(2, rowH * 0.25);
    for (let fi = 0; fi < features.length; fi++) {
      const f = features[fi];
      if (visibleKinds && !visibleKinds.includes(f.kind)) continue;
      // Only render when the feature falls inside the row's window.
      if (f.end < layout.gMin || f.start > layout.gMax) continue;
      // Map the genomic coords through the warp using the nearest exon
      // segment. Cheap heuristic: features outside any exon use the
      // window edges' compression, which we approximate by linear
      // interpolation between effMin and effMax.
      const rawSpan = layout.gMax - layout.gMin;
      const effSpan = layout.effMax - layout.effMin;
      const ratio = effSpan / Math.max(1, rawSpan);
      const fStart = Math.max(f.start, layout.gMin);
      const fEnd = Math.min(f.end, layout.gMax);
      const effFStart = layout.effMin + (fStart - layout.gMin) * ratio;
      const effFEnd = layout.effMin + (fEnd - layout.gMin) * ratio;
      let x1 = effToPx(effFStart);
      let x2 = effToPx(effFEnd);
      if (x2 < x1) [x1, x2] = [x2, x1];
      const w = Math.max(1.5, x2 - x1);
      elements.push(
        <rect
          key={`feat-${fi}`}
          x={x1}
          y={featY}
          width={w}
          height={featH}
          fill={featureColor(f)}
          stroke="var(--tbrowse-bg)"
          strokeWidth={0.5}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onTip({
              screenX: e.clientX,
              screenY: e.clientY,
              title: f.label ?? f.id,
              lines: [
                `${f.kind}${f.category ? ` · ${f.category}` : ''}`,
                `${geneStructure.region}:${f.start.toLocaleString()}–${f.end.toLocaleString()}`,
              ],
            });
          }}
        />,
      );
    }
  }

  // Introns (drawn under exons).
  for (const intron of layout.introns) {
    const x1raw = effToPx(intron.effStart);
    const x2raw = effToPx(intron.effEnd);
    const x1 = Math.min(x1raw, x2raw);
    const x2 = Math.max(x1raw, x2raw);
    const w = Math.max(0, x2 - x1);
    // Connector line + chevron in the middle.
    elements.push(
      <line
        key={`intron-${intron.key}-l`}
        x1={x1}
        y1={midY}
        x2={x2}
        y2={midY}
        stroke="var(--tbrowse-text-muted)"
        strokeWidth={1}
        pointerEvents="none"
      />,
    );
    const cx = (x1 + x2) / 2;
    const chevronW = Math.min(4, Math.max(2, w / 4));
    if (w > 6) {
      // Single chevron pointing 5'→3' — always rightward in the rendered
      // (post-flip) coordinate system, since `flipped` already mirrors
      // the row.
      elements.push(
        <polyline
          key={`intron-${intron.key}-c`}
          points={`${cx - chevronW / 2},${midY - 3} ${cx + chevronW / 2},${midY} ${cx - chevronW / 2},${midY + 3}`}
          fill="none"
          stroke="var(--tbrowse-text-muted)"
          strokeWidth={1}
          pointerEvents="none"
        />,
      );
    }
    if (intron.realLength > COMPRESSED_INTRON_NT) {
      const realKb = (intron.realLength / 1000).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });
      const tipText = intron.isCompressed
        ? `Intron (${realKb} kb) compressed — click to expand`
        : `Intron (${realKb} kb) — click to compress`;
      const hitW = Math.max(w, 14);
      const hitX = cx - hitW / 2;
      elements.push(
        <g
          key={`intron-${intron.key}-hit`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleIntron(intron.key);
          }}
          style={{ cursor: 'pointer' }}
        >
          <rect
            x={hitX}
            y={rowY}
            width={hitW}
            height={rowH}
            fill="transparent"
          />
          {intron.isCompressed ? (
            <g
              stroke="var(--tbrowse-accent)"
              strokeWidth={1.2}
              pointerEvents="none"
            >
              <line x1={cx - 2} y1={midY + 4} x2={cx} y2={midY - 4} />
              <line x1={cx} y1={midY + 4} x2={cx + 2} y2={midY - 4} />
            </g>
          ) : (
            <text
              x={cx}
              y={midY + 0.5}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={700}
              fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
              fill="var(--tbrowse-accent)"
              pointerEvents="none"
            >
              ↔
            </text>
          )}
          <title>{tipText}</title>
        </g>,
      );
    }
  }

  // Exons — render as UTR shoulder + CDS box. Each exon may have any of
  // (UTR-only), (CDS-only), or (UTR + CDS) shape; UTR portions render at
  // half height, CDS at full height (genome-browser convention).
  const altCount =
    geneStructure.transcripts.length > 1 ? geneStructure.transcripts.length : 0;
  for (let ei = 0; ei < layout.exons.length; ei++) {
    const exon = layout.exons[ei];
    const exonX1raw = effToPx(exon.effStart);
    const exonX2raw = effToPx(exon.effEnd);
    const exonX1 = Math.min(exonX1raw, exonX2raw);
    const exonX2 = Math.max(exonX1raw, exonX2raw);
    const utrFill = 'hsl(210 50% 70%)';
    const cdsFill = 'hsl(210 60% 45%)';

    // UTR portion = the exon range minus the CDS sub-range.
    if (exon.cdsEffStart === undefined || exon.cdsEffEnd === undefined) {
      const w = Math.max(1, exonX2 - exonX1);
      elements.push(
        <rect
          key={`exon-${ei}-utr`}
          x={exonX1}
          y={utrY}
          width={w}
          height={utrH}
          fill={utrFill}
          stroke="var(--tbrowse-bg)"
          strokeWidth={0.5}
          style={{ cursor: 'pointer' }}
          onClick={(e) =>
            handleExonClick(e, args, exon, ei, transcript, geneStructure, altCount)
          }
        />,
      );
      continue;
    }

    const cdsX1raw = effToPx(exon.cdsEffStart);
    const cdsX2raw = effToPx(exon.cdsEffEnd);
    const cdsX1 = Math.min(cdsX1raw, cdsX2raw);
    const cdsX2 = Math.max(cdsX1raw, cdsX2raw);

    if (exon.gStart < (exon.cdsGStart ?? exon.gStart)) {
      // Lower-coord UTR shoulder.
      elements.push(
        <rect
          key={`exon-${ei}-utr-low`}
          x={exonX1}
          y={utrY}
          width={Math.max(1, Math.min(cdsX1, cdsX2) - exonX1)}
          height={utrH}
          fill={utrFill}
          stroke="var(--tbrowse-bg)"
          strokeWidth={0.5}
          pointerEvents="none"
        />,
      );
    }
    if (exon.gEnd > (exon.cdsGEnd ?? exon.gEnd)) {
      // Higher-coord UTR shoulder.
      const xL = Math.max(cdsX1, cdsX2);
      elements.push(
        <rect
          key={`exon-${ei}-utr-high`}
          x={xL}
          y={utrY}
          width={Math.max(1, exonX2 - xL)}
          height={utrH}
          fill={utrFill}
          stroke="var(--tbrowse-bg)"
          strokeWidth={0.5}
          pointerEvents="none"
        />,
      );
    }
    elements.push(
      <rect
        key={`exon-${ei}-cds`}
        x={cdsX1}
        y={cdsY}
        width={Math.max(1, cdsX2 - cdsX1)}
        height={cdsH}
        fill={cdsFill}
        stroke="var(--tbrowse-bg)"
        strokeWidth={0.5}
        style={{ cursor: 'pointer' }}
        onClick={(e) =>
          handleExonClick(e, args, exon, ei, transcript, geneStructure, altCount)
        }
      />,
    );
  }

  // Strand indicator — defaults to the gene's natural strand. The user
  // override flips the indicator the opposite way to signal "you've
  // chosen to view this row away from its default orientation". Auto-flip
  // (which makes - strand genes read 5'→3' by default) does NOT change
  // the indicator on its own. Mirrors the neighborhood zone's UX.
  const indicatorStrand: 1 | -1 = userFlipped
    ? ((geneStructure.strand === 1 ? -1 : 1) as 1 | -1)
    : geneStructure.strand;
  const indicatorChar = indicatorStrand === 1 ? '+' : '−';
  const indicatorTitle =
    geneStructure.strand === -1
      ? flipped
        ? 'Reverse-strand gene shown 5\'→3\' — click to view as transcribed'
        : 'Reverse-strand gene shown as transcribed — click to flip 5\'→3\''
      : flipped
        ? 'Forward-strand gene mirrored — click to unflip'
        : 'Forward-strand gene — click to mirror';
  elements.push(
    <g
      key="indicator"
      onClick={(e) => {
        e.stopPropagation();
        onToggleFlip(nodeId);
      }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={PAD_X}
        y={indicatorY}
        width={INDICATOR_WIDTH}
        height={indicatorH}
        fill="transparent"
      />
      <text
        x={indicatorCx}
        y={indicatorY + indicatorH / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={13}
        fontWeight={700}
        fontFamily="ui-monospace, 'SF Mono', Menlo, monospace"
        fill="var(--tbrowse-text-muted)"
        pointerEvents="none"
      >
        {indicatorChar}
      </text>
      <title>{indicatorTitle}</title>
    </g>,
  );

  return <g>{elements}</g>;
}

function handleExonClick(
  e: React.MouseEvent,
  args: RenderRowArgs,
  exon: RowLayout['exons'][number],
  exonIndex: number,
  transcript: Transcript,
  geneStructure: GeneStructure,
  altCount: number,
) {
  e.stopPropagation();
  const lines: string[] = [];
  lines.push(`exon ${exonIndex + 1} of ${transcript.exons.length}`);
  lines.push(
    `${geneStructure.region}:${exon.gStart.toLocaleString()}–${exon.gEnd.toLocaleString()}`,
  );
  if (exon.cdsGStart !== undefined && exon.cdsGEnd !== undefined) {
    lines.push(
      `CDS ${exon.cdsGStart.toLocaleString()}–${exon.cdsGEnd.toLocaleString()}`,
    );
  } else {
    lines.push('UTR only');
  }
  if (altCount > 1) {
    const others = geneStructure.transcripts
      .filter((t) => t.id !== transcript.id)
      .slice(0, 6)
      .map((t) => `${t.id}${t.biotype ? ` (${t.biotype})` : ''}`);
    if (others.length > 0) {
      lines.push(`alt transcripts: ${others.join(', ')}`);
    }
  }
  args.onTip({
    screenX: e.clientX,
    screenY: e.clientY,
    title: `${geneStructure.name ?? args.geneId} · ${transcript.id}`,
    lines,
  });
}

function GenomeTooltip({
  tip,
  onClose,
}: {
  tip: { screenX: number; screenY: number; title: string; lines: string[] };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [onClose]);
  const margin = 8;
  const estW = 280;
  const estH = 140;
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
        minWidth: 200,
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
      {tip.lines.map((line, i) => (
        <div
          key={i}
          style={{
            color: 'var(--tbrowse-text-muted)',
            fontSize: 11,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
