import { useEffect, useMemo, useRef, useState } from 'react';
import { LEAF_ROW_HEIGHT } from '../../visibleRows';
import { EditableZoneName } from '../EditableZoneName';
import type {
  GeneId,
  Neighborhood,
  NeighborhoodGene,
  NodeId,
  ZoneDefinition,
  ZoneRenderProps,
} from '../../types';

/** Padding on each side of the row's drawing area. */
const PAD_X = 4;
/** Pixel column reserved on the left of every row for the +/- strand
 *  indicator. The arrow drawing area starts after this column. */
const INDICATOR_WIDTH = 16;
/** Vertical padding inside each row so arrows don't touch row borders. */
const ARROW_VPAD = 4;
/** Pointed-tip portion of the arrow as a fraction of its rendered width. */
const ARROW_TIP_FRAC = 0.35;
const ARROW_TIP_MAX = 7;
const ARROW_TIP_MIN = 1.5;
/** Smallest pixel width below which arrows degrade to a thin marker so
 *  every gene stays visible even when its bp width is tiny relative to
 *  the row's total span. */
const MIN_ARROW_PX = 3;
/** Default real (genomic) width of the fake terminal rectangle drawn
 *  at the smaller side's "computed end of the neighbourhood". Because
 *  this is a real width, it scales with the row like any other gene —
 *  the rectangle grows or shrinks pixel-wise as gaps elsewhere in the
 *  row compress / expand and the row's overall scale changes. */
const EDGE_TERMINAL_DEFAULT_WIDTH = 200;
/** Fallback colour for non-coding / family-less genes. */
const NO_FAMILY_COLOR = 'rgba(150, 150, 160, 0.55)';

/**
 * Per-zone state for the neighbourhood track.
 *
 * `flippedNodeIds` is a per-leaf override on the *automatic* flip rule
 * (rows whose centre gene's natural strand is `-1` are auto-flipped so
 * the centre arrow always points right). Toggling the +/- indicator on
 * a row flips that single row's effective orientation.
 *
 * `gapOverrideKeys` is the per-gap override list. Long gaps (gap
 * length > 4 × median gene length within the row) default to either
 * compressed or expanded based on `compressIntergenic`; a key
 * `"<rowNodeId>:gap:<leftId>-<rightId>"` in this list flips that
 * single gap to the OPPOSITE state (XOR semantics). Per-gap toggles
 * therefore always work — they always invert the current default.
 *
 * `compressIntergenic` is the zone-wide default for long gaps. When
 * true, long gaps are compressed unless their key appears in
 * `gapOverrideKeys`; when false they're expanded unless their key
 * appears.
 */
export interface NeighborhoodZoneState {
  /** User-set zone name; falls back to the factory default when undefined. */
  name?: string;
  flippedNodeIds: NodeId[];
  gapOverrideKeys: string[];
  compressIntergenic: boolean;
}

const DEFAULT_STATE: NeighborhoodZoneState = {
  flippedNodeIds: [],
  gapOverrideKeys: [],
  compressIntergenic: true,
};

/** A gap whose real length exceeds `LONG_GAP_THRESHOLD_FACTOR` × median
 *  gene length is "long" and gets compressed by default. */
const LONG_GAP_THRESHOLD_FACTOR = 4;
/** Compressed long gaps render with this much effective width (in
 *  median-gene-length units) so they're visible but unobtrusive. */
const COMPRESSED_GAP_FACTOR = 1;
/** Sentinel ids for the fake terminal genes prepended / appended to a
 *  neighbourhood when one side reaches much further than the other. The
 *  fake gene reuses every long-gap mechanism (compress / expand
 *  toggle, // and ↔ glyphs) so the layout pass needs no special
 *  edge-gap code — it just filters these ids out before rendering. */
const EDGE_TERMINAL_LEFT_ID = '__edge_left__';
const EDGE_TERMINAL_RIGHT_ID = '__edge_right__';
function isEdgeTerminal(id: GeneId): boolean {
  return id === EDGE_TERMINAL_LEFT_ID || id === EDGE_TERMINAL_RIGHT_ID;
}

/** Hue assigned to the centre gene's family — green sits in the middle
 *  of the rainbow gradient and reads as "this is the family of
 *  interest". */
const CENTER_FAMILY_HUE = 130;
/** Upstream-side rainbow endpoint, pushed past blue into violet so the
 *  upstream gradient covers the full cyan → blue → violet arc. The
 *  closest-to-centre upstream family gets a hue near
 *  `CENTER_FAMILY_HUE`; the farthest upstream family gets a hue near
 *  this value. */
const UPSTREAM_FAR_HUE = 290;
/** Downstream-side rainbow endpoint, pushed past orange/red into dark
 *  red. Expressed as a negative hue so the linear interpolation walks
 *  green → yellow → orange → red → dark red along the short arc; the
 *  result is normalised back into [0, 360) before storage. */
const DOWNSTREAM_FAR_HUE = -10;

/** Normalise a hue to [0, 360). Hues are computed in unwrapped space
 *  (which can go negative or past 360) so a linear interpolation along
 *  the rainbow short arc stays monotonic. */
function normHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

/**
 * Build a stable family-colour palette: gene_tree id → hue in [0, 360).
 *
 * 1. The centre family of the node-of-interest's neighbourhood is
 *    pinned to green (`CENTER_FAMILY_HUE`).
 * 2. Other families in that neighbourhood are walked in genomic
 *    order and assigned hues distributed across a rainbow gradient
 *    that flows blue → green (upstream) and green → orange/red
 *    (downstream), so adjacent genes get adjacent colours.
 * 3. Every remaining family across all rows is then processed in
 *    DESCENDING order of total occurrence count. For each, we look
 *    at the family's first appearance in any neighbourhood and
 *    interpolate between its already-coloured flanking neighbours'
 *    hues, so the new colour fits naturally into the gradient
 *    established by the existing palette. If neither flank is yet
 *    coloured, fall back to a stable hash so the colour at least
 *    stays consistent across renders.
 */
/** Stable hash → hue used as a last-resort fallback when a family
 *  has no coloured flanking gene to interpolate from. */
function hashFamilyHue(family: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < family.length; i++) {
    h ^= family.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

export function buildFamilyPalette(
  neighborhoods: Record<GeneId, Neighborhood> | undefined,
  noiGeneId: GeneId | undefined,
): Map<string, number> {
  const palette = new Map<string, number>();
  if (!neighborhoods) return palette;

  // Step 1 — centre of NoI's neighbourhood.
  const noiNh = noiGeneId ? neighborhoods[noiGeneId] : undefined;
  const centerFamily = noiNh?.center.geneTree;
  if (centerFamily) palette.set(centerFamily, CENTER_FAMILY_HUE);

  // Step 2 — rainbow distribution for NoI's other families. Walk
  // leftmost upstream → closest-to-centre upstream → closest-to-centre
  // downstream → rightmost downstream. Dedupe with a Set (O(1)
  // lookup) instead of array.includes (O(n)).
  if (noiNh) {
    const seen = new Set<string>();
    if (centerFamily) seen.add(centerFamily);
    const upstream: string[] = [];
    for (const g of noiNh.upstream) {
      const t = g.geneTree;
      if (t && !seen.has(t)) {
        upstream.push(t);
        seen.add(t);
      }
    }
    const downstream: string[] = [];
    for (const g of noiNh.downstream) {
      const t = g.geneTree;
      if (t && !seen.has(t)) {
        downstream.push(t);
        seen.add(t);
      }
    }
    const upN = upstream.length;
    for (let i = 0; i < upN; i++) {
      const t = (i + 1) / (upN + 1);
      const hue =
        UPSTREAM_FAR_HUE - t * (UPSTREAM_FAR_HUE - CENTER_FAMILY_HUE);
      palette.set(upstream[i], normHue(hue));
    }
    const downN = downstream.length;
    for (let i = 0; i < downN; i++) {
      const t = (i + 1) / (downN + 1);
      const hue =
        CENTER_FAMILY_HUE - t * (CENTER_FAMILY_HUE - DOWNSTREAM_FAR_HUE);
      palette.set(downstream[i], normHue(hue));
    }
  }

  // Step 3 — single pass over every row to (a) build a genomic-ordered
  // gene list per row, (b) tally frequencies of every still-uncoloured
  // family, and (c) record the FIRST occurrence of each such family
  // (`{ list, idx }`) so the interpolation pass can scan that row's
  // flanks directly without re-iterating the entire neighbourhood
  // collection.
  const frequency = new Map<string, number>();
  type Occurrence = { list: NeighborhoodGene[]; idx: number };
  const firstOccurrence = new Map<string, Occurrence>();
  // Allow a small fallback: if the FIRST occurrence has no coloured
  // flank in either direction, try one more occurrence before giving
  // up. Two occurrences cover virtually all useful cases without
  // blowing up to the O(N) worst case the previous code had.
  const secondOccurrence = new Map<string, Occurrence>();

  for (const id in neighborhoods) {
    const nh = neighborhoods[id];
    // Build the ordered list once per row (not once per family).
    const list: NeighborhoodGene[] = new Array(
      nh.upstream.length + 1 + nh.downstream.length,
    );
    let k = 0;
    for (const g of nh.upstream) list[k++] = g;
    list[k++] = nh.center;
    for (const g of nh.downstream) list[k++] = g;

    for (let i = 0; i < list.length; i++) {
      const family = list[i].geneTree;
      if (!family || palette.has(family)) continue;
      frequency.set(family, (frequency.get(family) ?? 0) + 1);
      if (!firstOccurrence.has(family)) {
        firstOccurrence.set(family, { list, idx: i });
      } else if (!secondOccurrence.has(family)) {
        secondOccurrence.set(family, { list, idx: i });
      }
    }
  }

  // Sort remaining families by descending frequency, ties broken
  // alphabetically so the assignment order is deterministic across
  // sessions.
  const remaining = [...frequency.keys()].sort((a, b) => {
    const da = frequency.get(b)! - frequency.get(a)!;
    return da !== 0 ? da : a < b ? -1 : 1;
  });

  for (const family of remaining) {
    let hue: number | undefined;
    const occA = firstOccurrence.get(family);
    if (occA) hue = resolveHueFromFlanks(family, occA, palette);
    if (hue === undefined) {
      const occB = secondOccurrence.get(family);
      if (occB) hue = resolveHueFromFlanks(family, occB, palette);
    }
    palette.set(family, hue ?? hashFamilyHue(family));
  }
  return palette;
}

function resolveHueFromFlanks(
  family: string,
  occ: { list: NeighborhoodGene[]; idx: number },
  palette: Map<string, number>,
): number | undefined {
  const { list, idx } = occ;
  let leftHue: number | undefined;
  let rightHue: number | undefined;
  // Combined `get`-and-test avoids the double hash lookup that
  // `has` + `get` would do; matters for tight inner loops.
  for (let j = idx - 1; j >= 0; j--) {
    const t = list[j].geneTree;
    if (!t || t === family) continue;
    const h = palette.get(t);
    if (h !== undefined) {
      leftHue = h;
      break;
    }
  }
  for (let j = idx + 1; j < list.length; j++) {
    const t = list[j].geneTree;
    if (!t || t === family) continue;
    const h = palette.get(t);
    if (h !== undefined) {
      rightHue = h;
      break;
    }
  }
  if (leftHue !== undefined && rightHue !== undefined) {
    return circularMidHue(leftHue, rightHue);
  }
  if (leftHue !== undefined) return (leftHue + 30) % 360;
  if (rightHue !== undefined) return (rightHue + 330) % 360;
  return undefined;
}

function circularMidHue(h1: number, h2: number): number {
  let d = h2 - h1;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return (h1 + d / 2 + 360) % 360;
}

/** Render a gene-family colour by looking up the family's hue in the
 *  precomputed palette. Falls back to a hash so unknown families still
 *  get a stable colour (shouldn't normally happen). */
function familyColor(
  geneTree: string,
  palette: Map<string, number>,
  alpha = 1,
): string {
  let hue = palette.get(geneTree);
  if (hue === undefined) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < geneTree.length; i++) {
      h ^= geneTree.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    hue = h % 360;
  }
  return alpha < 1
    ? `hsl(${hue} 65% 50% / ${alpha})`
    : `hsl(${hue} 65% 50%)`;
}

const GAP_DASH_CODE = 45; // '-'
const GAP_DOT_CODE = 46; // '.'

/** Pairwise %identity between two aligned sequences, ignoring columns
 *  where either side is a gap. Result in [0, 1]. Uses `charCodeAt`
 *  rather than string indexing so the inner loop stays in integer
 *  comparison space — matters because this runs N times (once per
 *  leaf) every time the user changes the node of interest. */
function pairwiseIdentity(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return 0;
  const len = Math.min(a.length, b.length);
  let n = 0;
  let match = 0;
  for (let i = 0; i < len; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (
      ca === GAP_DASH_CODE ||
      ca === GAP_DOT_CODE ||
      cb === GAP_DASH_CODE ||
      cb === GAP_DOT_CODE
    )
      continue;
    n++;
    if (ca === cb) match++;
  }
  return n > 0 ? match / n : 0;
}

/** Lightness ramp: similarity 0 → 80% (very pale), 1 → 25% (deep
 *  green). Hue 130 reads green even on a dark background. */
function centerColor(similarity: number): string {
  const sim = Math.max(0, Math.min(1, similarity));
  const lightness = 80 - 55 * sim;
  return `hsl(130 50% ${lightness}%)`;
}

const NeighborhoodHeader = ({
  hoveredNodeId,
  data,
  zoneState,
  setZoneState,
}: ZoneRenderProps<NeighborhoodZoneState>) => {
  const compressIntergenic = zoneState.compressIntergenic ?? true;
  const toggleCompress = () =>
    setZoneState((prev) => ({
      ...prev,
      compressIntergenic: !(prev.compressIntergenic ?? true),
    }));
  // Resolve the hovered leaf's central gene so its genomic context can
  // be displayed below the title bar. Internal-node hovers (which can
  // happen when the user hovers a clade in the tree zone) don't have a
  // direct neighborhood entry; we fall back to the placeholder.
  const hoveredInfo = (() => {
    if (!hoveredNodeId) return null;
    const node = data.tree.nodes[hoveredNodeId];
    if (!node?.geneId) return null;
    const nh = data.neighborhood?.[node.geneId];
    if (!nh) return null;
    const c = nh.center;
    const strandSign = c.strand === -1 ? '−' : '+';
    const parts: string[] = [];
    // Taxonomy first — leftmost, longest-lived context for the row.
    if (node.taxonomyId !== undefined && data.taxonomy?.[node.taxonomyId]) {
      const tax = data.taxonomy[node.taxonomyId];
      const name = tax.scientificName ?? tax.commonName;
      if (name) parts.push(name);
    }
    parts.push(
      `${c.region ?? '?'}:${c.start.toLocaleString()}–${c.end.toLocaleString()} (${strandSign})`,
    );
    return parts.join(' · ');
  })();
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
          gap: 8,
          padding: '0 10px 0 18px',
        }}
      >
        <EditableZoneName
          defaultName="Neighborhood"
          customName={zoneState?.name}
          onChange={(next) =>
            setZoneState((s) => ({ ...(s ?? DEFAULT_STATE), name: next }))
          }
        />
        <span
          style={{
            fontWeight: 400,
            color: 'var(--tbrowse-text-muted)',
            fontSize: 11,
          }}
        >
          ±10 flanking genes
        </span>
        <button
          type="button"
          onClick={toggleCompress}
          title={
            compressIntergenic
              ? 'Long intergenic regions compressed — click to expand all'
              : 'Long intergenic regions expanded — click to compress all'
          }
          style={{
            fontSize: 11,
            padding: '1px 6px',
            border: `1px solid ${compressIntergenic ? 'var(--tbrowse-accent)' : 'var(--tbrowse-border)'}`,
            background: compressIntergenic
              ? 'var(--tbrowse-accent-soft)'
              : 'var(--tbrowse-bg-input)',
            color: compressIntergenic
              ? 'var(--tbrowse-accent-strong)'
              : 'var(--tbrowse-text)',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          //
        </button>
      </div>
      {/* Live readout of the hovered row's central gene location. */}
      <div
        style={{
          flex: `0 0 ${LEAF_ROW_HEIGHT}px`,
          minHeight: 0,
          padding: '0 10px 0 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
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
            hover a neighborhood…
          </span>
        )}
      </div>
    </div>
  );
};

interface ArrowLayout {
  gene: NeighborhoodGene;
  /** Pixel x of the rendered arrow's left edge. */
  x: number;
  /** Pixel width of the rendered arrow. */
  width: number;
  /** Effective rendered strand (already accounts for the row's flip). */
  strand: 1 | -1;
  /** True for the centre cell (the leaf gene itself). */
  isCenter: boolean;
  /** True for the fake terminal injected by `buildWarp` to mark the
   *  computed end of an asymmetric neighbourhood. Renders as a solid
   *  black rectangle (not an arrow), is excluded from overlap /
   *  half-height detection, and doesn't open a tooltip on click. */
  isEdgeMarker: boolean;
}

interface GapLayout {
  /** Stable key used as the override entry in `expandedGapKeys`. */
  key: string;
  /** Pixel x of the gap's left edge. */
  x: number;
  /** Pixel width. */
  width: number;
  /** True genomic length of the gap, surfaced in the tooltip. */
  realLength: number;
  /** Whether the gap is currently rendered compressed (true) or at
   *  real scale (false). */
  isCompressed: boolean;
}

/**
 * Build a "warp map" — effective per-gene start/end coordinates that
 * collapse long intergenic gaps to a fixed shorter width. The
 * downstream layout pass then maps EFFECTIVE coordinates to pixels
 * exactly the same way it used to map real coordinates, so a single
 * `pxPerEff` scale still works.
 *
 * Long-gap classification is per-row: anything > 5 × median gene
 * length in the row's gene set. Override is per (row, gap) pair so
 * the user can selectively expand specific gaps without affecting
 * others.
 *
 * If one side of the centre reaches further than the other by more
 * than the long-gap threshold, a fake terminal gene with real
 * (genomic) width `EDGE_TERMINAL_DEFAULT_WIDTH` is injected into the
 * sorted array at the smaller side. Its outer edge is anchored at
 * the "computed end of the neighbourhood" — `centerMid ± maxReach`
 * — so it acts as a real boundary marker. The gap between it and
 * the smaller side's outermost real gene then participates in the
 * normal Phase-1 walk and registers as a regular long gap; the
 * built-in compress / expand machinery handles it identically to any
 * other long gap, so all gaps on the smaller side compress in the
 * same way as on the opposite half of the row.
 */
function buildWarp(
  nh: Neighborhood,
  overrideKeys: Set<string>,
  rowNodeId: NodeId,
  compressDefault: boolean,
): {
  sorted: NeighborhoodGene[];
  effStart: number[];
  effEnd: number[];
  longGaps: Array<{
    key: string;
    leftIdx: number;
    rightIdx: number;
    realLength: number;
    isCompressed: boolean;
  }>;
  centerIdx: number;
} {
  const realSorted = [...nh.upstream, nh.center, ...nh.downstream].sort(
    (a, b) => a.start - b.start,
  );
  // Median is computed on the real genes only; the fake terminal must
  // not skew the threshold that decides what counts as a long gap.
  const lengths = realSorted.map((g) => Math.max(0, g.end - g.start));
  const sortedLens = [...lengths].sort((a, b) => a - b);
  const medianLen = sortedLens[Math.floor(sortedLens.length / 2)] ?? 1;
  const threshold = Math.max(1, medianLen) * LONG_GAP_THRESHOLD_FACTOR;
  const compressedSize = Math.max(1, medianLen) * COMPRESSED_GAP_FACTOR;

  // Inject the fake terminal at the smaller side's "computed end of
  // the neighbourhood". The fake has a real (genomic) width — its
  // outer edge is anchored at `centerMid ± maxReach`, so the gap
  // between it and the outermost real gene equals
  // `asymmetry − fakeWidth`. We pick the largest fake width that
  // (a) doesn't exceed `EDGE_TERMINAL_DEFAULT_WIDTH` and (b) leaves
  // a gap comfortably above the long-gap threshold so the gap
  // auto-registers as a long gap and gets the // / ↔ click
  // affordance.
  const centerMid = (nh.center.start + nh.center.end) / 2;
  const leftReach = centerMid - realSorted[0].start;
  const rightReach = realSorted[realSorted.length - 1].end - centerMid;
  const maxReach = Math.max(leftReach, rightReach);
  const asymmetry = Math.abs(leftReach - rightReach);
  const edgeOnLeft = leftReach < rightReach;
  // Cap by `asymmetry − threshold − 1` so the residual gap is
  // strictly greater than `threshold`.
  const fakeWidth = Math.min(
    EDGE_TERMINAL_DEFAULT_WIDTH,
    Math.max(0, asymmetry - threshold - 1),
  );

  const sorted: NeighborhoodGene[] = [...realSorted];
  if (fakeWidth > 0) {
    if (edgeOnLeft) {
      const start = centerMid - maxReach;
      sorted.unshift({
        id: EDGE_TERMINAL_LEFT_ID,
        strand: 1,
        start,
        end: start + fakeWidth,
      });
    } else {
      const end = centerMid + maxReach;
      sorted.push({
        id: EDGE_TERMINAL_RIGHT_ID,
        strand: 1,
        start: end - fakeWidth,
        end,
      });
    }
  }

  // Single Phase-1 walk over the entire sorted array, fake included.
  // Internal long gaps and the edge-side gap (between the fake and
  // the outermost real gene) all flow through the same
  // compressed-offset accumulator, so any of them can be toggled
  // independently and they all behave the same way.
  const effStart: number[] = new Array(sorted.length);
  const effEnd: number[] = new Array(sorted.length);
  const longGaps: Array<{
    key: string;
    leftIdx: number;
    rightIdx: number;
    realLength: number;
    isCompressed: boolean;
  }> = [];

  let compressed = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const gapLen = cur.start - prev.end;
      if (gapLen > threshold) {
        const key = `${rowNodeId}:gap:${prev.id}-${cur.id}`;
        // Effective state = global default XOR per-gap override.
        // Per-gap toggle therefore always flips the displayed state of
        // its target gap, regardless of the global setting.
        const overridden = overrideKeys.has(key);
        const isCompressed = compressDefault !== overridden;
        longGaps.push({
          key,
          leftIdx: i - 1,
          rightIdx: i,
          realLength: gapLen,
          isCompressed,
        });
        if (isCompressed) compressed += gapLen - compressedSize;
      }
      // Non-long gaps (including negative ones for overlapping genes)
      // don't change `compressed` — overlap is preserved as-is.
    }
    const g = sorted[i];
    effStart[i] = g.start - compressed;
    effEnd[i] = g.end - compressed;
  }

  const centerIdx = sorted.findIndex((g) => g.id === nh.center.id);
  return { sorted, effStart, effEnd, longGaps, centerIdx };
}

/**
 * Lay each gene out in EFFECTIVE-coordinate space (after long-gap
 * compression) with three anchor points pinned regardless of any
 * gap compression in the row:
 *   • the centre gene's effective midpoint pins to the row's pixel
 *     midpoint (`midPx`),
 *   • the leftmost element's effective start pins to the row's left
 *     drawing edge (`drawingX`),
 *   • the rightmost element's effective end pins to the row's right
 *     drawing edge (`drawingX + drawingWidth`).
 *
 * That requires a split scale — `pxPerLeft = halfPx / leftSpan` and
 * `pxPerRight = halfPx / rightSpan` set independently for each half
 * — so when gaps on one side compress and that half's effective span
 * shrinks, the half rescales to keep its extreme pinned to the
 * matching row edge. Genes that straddle the centre (in practice
 * just the centre gene itself) have their two edges mapped through
 * the corresponding half's scale.
 *
 * The fake terminal injected by `buildWarp` plays the role of the
 * smaller side's extreme, so both row edges anchor on every row.
 *
 * When `flipped` is true the row is mirrored around its centreline:
 * pixel x positions reflect across `midPx` and every strand inverts
 * so the upstream arm appears on the right and the centre arrow
 * visibly points right (the standard "5'→3'" reading direction).
 */
function layoutNeighborhood(
  nh: Neighborhood,
  drawingX: number,
  drawingWidth: number,
  flipped: boolean,
  expandedKeys: Set<string>,
  rowNodeId: NodeId,
  compressEnabled: boolean,
): { arrows: ArrowLayout[]; gaps: GapLayout[] } {
  const halfPx = drawingWidth / 2;
  const midPx = drawingX + halfPx;

  const warp = buildWarp(nh, expandedKeys, rowNodeId, compressEnabled);
  const { sorted, effStart, effEnd, longGaps, centerIdx } = warp;

  if (centerIdx < 0) return { arrows: [], gaps: [] };

  // Effective extremes after warp compression.
  let minEff = Infinity;
  let maxEff = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    if (effStart[i] < minEff) minEff = effStart[i];
    if (effEnd[i] > maxEff) maxEff = effEnd[i];
  }
  const centerMidEff = (effStart[centerIdx] + effEnd[centerIdx]) / 2;
  const leftSpan = Math.max(0, centerMidEff - minEff);
  const rightSpan = Math.max(0, maxEff - centerMidEff);
  // Split scale — each half maps its own effective span onto `halfPx`
  // so the leftmost element pins to `drawingX`, the rightmost to
  // `drawingX + drawingWidth`, and the centre stays at `midPx`. As
  // gaps on either side compress, only that half's `pxPerEff`
  // rescales; the three anchors don't move.
  const pxPerLeft = halfPx / Math.max(1, leftSpan);
  const pxPerRight = halfPx / Math.max(1, rightSpan);
  const effToPx = (eff: number) =>
    eff <= centerMidEff
      ? midPx + (eff - centerMidEff) * pxPerLeft
      : midPx + (eff - centerMidEff) * pxPerRight;

  const arrows: ArrowLayout[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    const isEdgeMarker = isEdgeTerminal(g.id);
    const left = effToPx(effStart[i]);
    const right = effToPx(effEnd[i]);
    let x = left;
    // Edge terminals have a real (genomic) width like any other
    // gene; their pixel width therefore grows / shrinks as gaps
    // elsewhere in the row compress and the layout scale changes.
    const width = Math.max(MIN_ARROW_PX, right - left);
    let strand: 1 | -1 = g.strand;
    if (flipped) {
      x = 2 * midPx - left - width;
      strand = (-strand) as 1 | -1;
    }
    arrows.push({
      gene: g,
      x,
      width,
      strand,
      isCenter: i === centerIdx,
      isEdgeMarker,
    });
  }

  const gaps: GapLayout[] = [];
  for (const lg of longGaps) {
    const leftEff = effEnd[lg.leftIdx];
    const rightEff = effStart[lg.rightIdx];
    let leftPx = effToPx(leftEff);
    let rightPx = effToPx(rightEff);
    if (flipped) {
      const newLeft = 2 * midPx - rightPx;
      const newRight = 2 * midPx - leftPx;
      leftPx = newLeft;
      rightPx = newRight;
    }
    gaps.push({
      key: lg.key,
      x: leftPx,
      width: Math.max(0, rightPx - leftPx),
      realLength: lg.realLength,
      isCompressed: lg.isCompressed,
    });
  }

  return { arrows, gaps };
}

function arrowPoints(
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  strand: 1 | -1,
): string {
  const tip = Math.max(
    ARROW_TIP_MIN,
    Math.min(ARROW_TIP_MAX, cellW * ARROW_TIP_FRAC),
  );
  if (cellW <= tip * 2) {
    if (strand === 1) {
      return `${cellX},${cellY} ${cellX + cellW},${cellY + cellH / 2} ${cellX},${cellY + cellH}`;
    }
    return `${cellX + cellW},${cellY} ${cellX},${cellY + cellH / 2} ${cellX + cellW},${cellY + cellH}`;
  }
  const left = cellX;
  const right = cellX + cellW;
  const top = cellY;
  const bot = cellY + cellH;
  const midY = cellY + cellH / 2;
  if (strand === 1) {
    return [
      [left, top],
      [right - tip, top],
      [right, midY],
      [right - tip, bot],
      [left, bot],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
  }
  return [
    [right, top],
    [left + tip, top],
    [left, midY],
    [left + tip, bot],
    [right, bot],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(' ');
}

const NeighborhoodBody = ({
  visibleRows,
  rowRange,
  width,
  data,
  hoveredNodeId,
  hoveredSubtreeIds,
  selectedNodeId,
  nodeOfInterestId,
  onHoverNode,
  zoneState,
  setZoneState,
}: ZoneRenderProps<NeighborhoodZoneState>) => {
  // Pairwise identity to the node-of-interest's MSA row — computed
  // LAZILY rather than eagerly across the whole tree. The previous
  // version walked every leaf and called `pairwiseIdentity` for each
  // on every NoI change, which scales as O(N_leaves × MSA length)
  // even though only the few visible centre rows actually need it.
  // Now we capture the NoI's sequence once and expose a function
  // that computes-and-caches similarity per leaf on demand. The
  // cache lives in a Map that is recreated whenever (msa, NoI)
  // changes, so correctness is preserved.
  const noiSeq = useMemo<string | null>(() => {
    if (!data.msa || !nodeOfInterestId) return null;
    const noiNode = data.tree.nodes[nodeOfInterestId];
    if (!noiNode?.geneId) return null;
    return data.msa.sequences[noiNode.geneId] ?? null;
  }, [data.msa, data.tree.nodes, nodeOfInterestId]);
  const similarityCache = useMemo(
    () => new Map<GeneId, number>(),
    [data.msa, noiSeq],
  );
  const getSimilarity = (geneId: GeneId | undefined): number => {
    if (!geneId || !noiSeq || !data.msa) return 0;
    const cached = similarityCache.get(geneId);
    if (cached !== undefined) return cached;
    const seq = data.msa.sequences[geneId];
    const sim = seq ? pairwiseIdentity(noiSeq, seq) : 0;
    similarityCache.set(geneId, sim);
    return sim;
  };

  // Resolve the node of interest to its gene id so the palette
  // dependency is on the gene id directly. When the user picks a
  // different node of interest, this memo emits a new gene id, which
  // in turn invalidates the palette memo and the whole family-colour
  // assignment is rebuilt around the new centre.
  const noiGeneId = useMemo<GeneId | undefined>(() => {
    if (!nodeOfInterestId) return undefined;
    return data.tree.nodes[nodeOfInterestId]?.geneId;
  }, [data.tree.nodes, nodeOfInterestId]);

  // Family-colour palette: green for the centre family of the NoI's
  // neighbourhood, rainbow-distributed for its other families,
  // descending-frequency interpolation for everything else. Computed
  // once per (data, NoI) pair and shared across every row, so picking
  // a different node of interest reassigns colours globally.
  const familyPalette = useMemo(
    () => buildFamilyPalette(data.neighborhood, noiGeneId),
    [data.neighborhood, noiGeneId],
  );

  const flippedSet = useMemo(
    () => new Set(zoneState.flippedNodeIds ?? []),
    [zoneState.flippedNodeIds],
  );
  const gapOverrideSet = useMemo(
    () => new Set(zoneState.gapOverrideKeys ?? []),
    [zoneState.gapOverrideKeys],
  );
  const compressIntergenic = zoneState.compressIntergenic ?? true;
  const toggleGap = (key: string) => {
    setZoneState((prev) => {
      const cur = prev.gapOverrideKeys ?? [];
      const idx = cur.indexOf(key);
      const next = idx >= 0 ? cur.filter((x) => x !== key) : [...cur, key];
      return { ...prev, gapOverrideKeys: next };
    });
  };

  // Click-driven gene tooltip (replaces the slow native <title>). Held
  // as local UI state — closing it doesn't pollute the URL. Cleared on
  // outside click (registered by the tooltip itself) or Escape.
  type GeneTip = {
    screenX: number;
    screenY: number;
    gene: NeighborhoodGene;
    isCenter: boolean;
    /** Pairwise %identity to the node-of-interest's MSA row, in [0, 1].
     *  Set on centre-gene clicks when an NoI is selected and both
     *  leaves carry an MSA row. Other clicks omit it. */
    identity?: number;
  };
  const [geneTip, setGeneTip] = useState<GeneTip | null>(null);
  // Hovering any gene with a `geneTree` highlights every other gene
  // that shares that family — a cross-row border so the user can
  // visually trace conserved synteny. Edge-marker rectangles and
  // family-less genes don't participate. The state is local because
  // it's a transient UI signal, not part of view state.
  const [hoveredFamily, setHoveredFamily] = useState<string | null>(null);
  useEffect(() => {
    if (!geneTip) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGeneTip(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [geneTip]);
  const toggleFlip = (nodeId: NodeId) => {
    setZoneState((prev) => {
      const cur = prev.flippedNodeIds ?? [];
      const idx = cur.indexOf(nodeId);
      const next = idx >= 0 ? cur.filter((x) => x !== nodeId) : [...cur, nodeId];
      return { ...prev, flippedNodeIds: next };
    });
  };

  const totalHeight = useMemo(
    () =>
      visibleRows.length > 0
        ? visibleRows[visibleRows.length - 1].y +
          visibleRows[visibleRows.length - 1].height
        : 0,
    [visibleRows],
  );

  const drawingX = PAD_X + INDICATOR_WIDTH;
  const drawingWidth = Math.max(1, width - 2 * PAD_X - INDICATOR_WIDTH);
  const centerLineX = drawingX + drawingWidth / 2;
  const indicatorCx = PAD_X + INDICATOR_WIDTH / 2;

  const rows = visibleRows.slice(rowRange.startIndex, rowRange.endIndex);

  return (
    <>
    <svg
      width={width}
      height={totalHeight}
      style={{ display: 'block', shapeRendering: 'crispEdges' }}
    >
      {/* Centerline marking the central column across all rows — the
          gene of interest's lineage. */}
      <line
        x1={centerLineX}
        y1={0}
        x2={centerLineX}
        y2={totalHeight}
        stroke="red"
        strokeOpacity={0.18}
        strokeWidth={1}
        pointerEvents="none"
      />
      {rows.map((r) => {
        if (r.kind !== 'leaf') return null;
        const node = data.tree.nodes[r.nodeId];
        if (!node?.geneId) return null;
        const nh = data.neighborhood?.[node.geneId];
        if (!nh) return null;
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
        // Auto-flip rows whose centre gene reads on the reverse strand
        // so every centre arrow points right by default. The user
        // override XORs that decision.
        const autoFlip = nh.center.strand === -1;
        const userOverride = flippedSet.has(r.nodeId);
        const flipped = autoFlip !== userOverride;
        // The indicator reflects the row's CURRENT orientation as the
        // user perceives it. Initially (no user flip) it matches the
        // centre gene's natural strand; each click on the indicator
        // flips the row and swaps the glyph. This is independent of
        // the auto-flip rule — auto-flip only orients the rendered
        // arrows; the indicator anchors to "where + and − sit on the
        // chromosome from the user's current viewpoint". The gene
        // tooltip continues to show each gene's natural strand.
        const { arrows, gaps } = layoutNeighborhood(
          nh,
          drawingX,
          drawingWidth,
          flipped,
          gapOverrideSet,
          r.nodeId,
          compressIntergenic,
        );
        const arrowH = r.height - ARROW_VPAD * 2;
        const arrowY = r.y + ARROW_VPAD;
        const opacity = r.opacity ?? 1;
        // Per-arrow half-height test: an arrow becomes half-height (and
        // shifts to a lane above or below the chromosome axis) ONLY
        // when it horizontally overlaps another arrow with the
        // OPPOSITE natural strand. Same-strand overlaps stay
        // full-height; everything else stays full-height. The lane
        // assignment puts every same-strand-as-centre gene in the top
        // lane and every opposite-strand gene in the bottom lane.
        const laneGap = 1; // pixels between the two half-lanes
        const halfH = Math.max(2, (arrowH - laneGap) / 2);
        const topY = arrowY;
        const bottomY = arrowY + halfH + laneGap;
        const isHalfHeight: boolean[] = arrows.map((a, i) => {
          if (a.isEdgeMarker) return false;
          for (let j = 0; j < arrows.length; j++) {
            if (i === j) continue;
            const b = arrows[j];
            if (b.isEdgeMarker) continue;
            if (a.gene.strand === b.gene.strand) continue;
            if (a.x < b.x + b.width && b.x < a.x + a.width) return true;
          }
          return false;
        });
        const indicatorStrand: 1 | -1 = userOverride
          ? ((nh.center.strand === 1 ? -1 : 1) as 1 | -1)
          : nh.center.strand;
        const indicatorChar = indicatorStrand === 1 ? '+' : '−';
        const indicatorTitle = userOverride
          ? `Neighborhood is flipped (showing as ${indicatorChar} strand) — click to unflip`
          : `Centre gene is on the ${indicatorChar} strand — click to flip neighborhood`;
        return (
          <g
            key={`row-${r.nodeId}`}
            opacity={opacity}
            transform={`translate(${-32 * (1 - opacity)}, 0)`}
            // Hover still highlights the matching subtree in the tree
            // zone, but click does NOT select the node — clicking
            // inside the neighbourhood should not pop the tree
            // tooltip. The +/- indicator below has its own click
            // handler with stopPropagation so its hits don't bubble.
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
          >
            {rowBg && (
              <rect x={0} y={r.y} width={width} height={r.height} fill={rowBg} />
            )}
            {/* Strand indicator — clickable badge on the row's left
                edge. Renders the rendered (post-flip) direction so the
                glyph always matches what the user sees. */}
            <g
              onClick={(e) => {
                e.stopPropagation();
                toggleFlip(r.nodeId);
              }}
              style={{ cursor: 'pointer' }}
            >
              <rect
                x={PAD_X}
                y={r.y}
                width={INDICATOR_WIDTH}
                height={r.height}
                fill="transparent"
              />
              <text
                x={indicatorCx}
                y={r.y + r.height / 2 + 0.5}
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
            </g>
            {/* Faint baseline showing the chromosome stretch. Drawn
                under the arrows so non-coding gaps still read as
                "chromosome". */}
            <line
              x1={drawingX}
              y1={arrowY + arrowH / 2}
              x2={drawingX + drawingWidth}
              y2={arrowY + arrowH / 2}
              stroke="var(--tbrowse-text-subtle)"
              strokeOpacity={0.25}
              strokeWidth={0.75}
            />
            {arrows.map((a, i) => {
              if (a.isEdgeMarker) {
                // Solid black rectangle marking the smaller side's
                // neighbourhood boundary. Real (genomic) width so
                // its pixel width grows / shrinks as gaps elsewhere
                // compress and the layout scale changes.
                // Non-interactive — the adjacent long-gap // / ↔
                // glyph carries the compress / expand affordance.
                return (
                  <rect
                    key={`${r.nodeId}-${i}-edge`}
                    x={a.x}
                    y={arrowY}
                    width={a.width}
                    height={arrowH}
                    fill="var(--tbrowse-text)"
                    pointerEvents="none"
                  >
                    <title>End of neighborhood window</title>
                  </rect>
                );
              }
              const fill = a.isCenter
                ? centerColor(getSimilarity(a.gene.id))
                : a.gene.geneTree
                  ? familyColor(a.gene.geneTree, familyPalette)
                  : NO_FAMILY_COLOR;
              // Half-height + lane split applies only to genes that
              // overlap an opposite-strand neighbour. Everything else
              // stays full height regardless of row contents.
              const isHalf = isHalfHeight[i];
              const sameAsCenter = a.gene.strand === nh.center.strand;
              const aY = isHalf ? (sameAsCenter ? topY : bottomY) : arrowY;
              const aH = isHalf ? halfH : arrowH;
              // Highlight every gene whose family matches the
              // currently-hovered family, including the hovered gene
              // itself. Family-less genes never participate.
              const isFamilyHighlighted =
                hoveredFamily !== null && a.gene.geneTree === hoveredFamily;
              return (
                <polygon
                  key={`${r.nodeId}-${i}-${a.gene.id}`}
                  points={arrowPoints(a.x, aY, a.width, aH, a.strand)}
                  fill={fill}
                  stroke={
                    isFamilyHighlighted
                      ? 'var(--tbrowse-accent)'
                      : 'var(--tbrowse-bg)'
                  }
                  strokeWidth={isFamilyHighlighted ? 1.75 : 0.5}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => {
                    if (a.gene.geneTree) setHoveredFamily(a.gene.geneTree);
                  }}
                  onMouseLeave={() => {
                    if (a.gene.geneTree) setHoveredFamily(null);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setGeneTip({
                      screenX: e.clientX,
                      screenY: e.clientY,
                      gene: a.gene,
                      isCenter: a.isCenter,
                      identity: a.isCenter
                        ? getSimilarity(a.gene.id)
                        : undefined,
                    });
                  }}
                />
              );
            })}
            {/* Long-gap toggles. Compressed gaps render with two short
                diagonal slashes ("//"); expanded long gaps render with
                a "↔" so the user can compress them again. The hit
                rectangle is stretched to a minimum width so even very
                narrow compressed gaps are easy to click. */}
            {gaps.map((g) => {
              const cx = g.x + g.width / 2;
              const cy = arrowY + arrowH / 2;
              const hitW = Math.max(g.width, 14);
              const hitX = cx - hitW / 2;
              const realKb = (g.realLength / 1000).toLocaleString(undefined, {
                maximumFractionDigits: 1,
              });
              const tipText = g.isCompressed
                ? `Long intergenic gap (${realKb} kb) — click to expand`
                : `Intergenic gap (${realKb} kb) — click to compress`;
              return (
                <g
                  key={g.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGap(g.key);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <rect
                    x={hitX}
                    y={arrowY}
                    width={hitW}
                    height={arrowH}
                    fill="transparent"
                  />
                  {g.isCompressed ? (
                    // Two diagonal slashes drawn 2px apart for a tight
                    // "cut-mark" look. Same pattern as the tree zone's
                    // branch-compression glyph, just smaller.
                    <g
                      stroke="var(--tbrowse-accent)"
                      strokeWidth={1.2}
                      pointerEvents="none"
                    >
                      <line x1={cx - 2} y1={cy + 4} x2={cx} y2={cy - 4} />
                      <line x1={cx} y1={cy + 4} x2={cx + 2} y2={cy - 4} />
                    </g>
                  ) : (
                    <text
                      x={cx}
                      y={cy + 0.5}
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
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
    {geneTip && (
      <NeighborhoodGeneTooltip tip={geneTip} onClose={() => setGeneTip(null)} />
    )}
    </>
  );
};

function NeighborhoodGeneTooltip({
  tip,
  onClose,
}: {
  tip: {
    screenX: number;
    screenY: number;
    gene: NeighborhoodGene;
    isCenter: boolean;
    identity?: number;
  };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click dismissal. Deferred so the click that opened the
  // tooltip can't immediately fire the doc-level handler.
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

  // Clamp into the viewport so a click near the right/bottom edge
  // doesn't push the tooltip off-screen.
  const margin = 8;
  const estW = 280;
  const estH = 160;
  const left = Math.min(tip.screenX + 12, window.innerWidth - estW - margin);
  const top = Math.min(tip.screenY + 12, window.innerHeight - estH - margin);

  const g = tip.gene;
  const strandSign = g.strand === -1 ? '−' : '+';
  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 2000,
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
        <div style={{ fontWeight: 600 }}>{g.name ?? g.id}</div>
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
      <div
        style={{
          color: 'var(--tbrowse-text-muted)',
          fontSize: 11,
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        }}
      >
        {g.id}
      </div>
      {tip.isCenter && (
        <div
          style={{
            color: 'var(--tbrowse-text-muted)',
            fontSize: 11,
            fontStyle: 'italic',
          }}
        >
          ● centre gene
        </div>
      )}
      {tip.isCenter && tip.identity !== undefined && (
        <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
          {(tip.identity * 100).toFixed(1)}% identity to node of interest
        </div>
      )}
      {g.biotype && (
        <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
          {g.biotype}
        </div>
      )}
      <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
        {g.region ?? '?'}:{g.start.toLocaleString()}–{g.end.toLocaleString()} ({strandSign})
      </div>
      {g.geneTree && (
        <div style={{ color: 'var(--tbrowse-text-muted)', fontSize: 11 }}>
          family {g.geneTree}
        </div>
      )}
      {g.description && (
        <div style={{ color: 'var(--tbrowse-text)', fontSize: 11, marginTop: 4 }}>
          {g.description}
        </div>
      )}
      {/* Reserved area for future action buttons. */}
    </div>
  );
}

export const neighborhoodZone: ZoneDefinition<NeighborhoodZoneState> = {
  id: 'neighborhood',
  displayName: 'Neighborhood',
  Header: NeighborhoodHeader,
  Body: NeighborhoodBody,
  defaultWidth: 30,
  minWidth: 200,
  defaultZoneState: DEFAULT_STATE,
  isAvailable: (data) =>
    Boolean(data.neighborhood && Object.keys(data.neighborhood).length > 0),
  // Off by default — the neighborhood track is opt-in. The chassis
  // auto-flips this on the first time `data.neighborhood` is
  // populated, so hosts that always have neighborhood data still
  // see the zone appear without intervention; hosts that never
  // have neighborhood data leave it hidden, and the toggle stays
  // disabled.
  defaultVisible: false,
};
