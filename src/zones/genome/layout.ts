import type {
  GeneStructure,
  GenomeFeature,
  Transcript,
} from '../../types';

/** Long introns get squashed to this many "effective nt" of width
 *  (50 + // glyph + 50, conceptually). Anything shorter is left alone. */
export const COMPRESSED_INTRON_NT = 100;
/** Introns longer than this real-nt length are eligible for compression. */
export const LONG_INTRON_THRESHOLD_NT = COMPRESSED_INTRON_NT;

export interface CdsMap {
  peptideLength: number;
  cdsLength: number;
  /** Genomic coord of the very first CDS nucleotide in transcript order
   *  (the 5'-most end of the start codon). On `+` strand this is the
   *  smallest CDS genomic coord; on `-` strand the largest. */
  startCodonGenomic: number;
  /** Genomic coord of the last CDS nucleotide in transcript order. */
  stopCodonGenomic: number;
}

export function buildCdsMap(
  transcript: Transcript,
  strand: 1 | -1,
): CdsMap | null {
  const cdsExons = transcript.exons
    .filter((e) => e.cdsStart !== undefined && e.cdsEnd !== undefined)
    .map((e) => ({
      gStart: Math.max(e.start, e.cdsStart!),
      gEnd: Math.min(e.end, e.cdsEnd!),
    }))
    .filter((e) => e.gEnd >= e.gStart);
  if (cdsExons.length === 0) return null;
  cdsExons.sort((a, b) =>
    strand === 1 ? a.gStart - b.gStart : b.gStart - a.gStart,
  );
  let cdsLength = 0;
  for (const e of cdsExons) cdsLength += e.gEnd - e.gStart + 1;
  const peptideLength = Math.floor(cdsLength / 3);
  const first = cdsExons[0];
  const last = cdsExons[cdsExons.length - 1];
  return {
    peptideLength,
    cdsLength,
    startCodonGenomic: strand === 1 ? first.gStart : first.gEnd,
    stopCodonGenomic: strand === 1 ? last.gEnd : last.gStart,
  };
}

export interface ExonSegment {
  /** Index into `transcript.exons` (genomic-ascending order). */
  exonIndex: number;
  gStart: number;
  gEnd: number;
  /** Effective coords (genomic minus accumulated intron compression). */
  effStart: number;
  effEnd: number;
  /** CDS sub-range, if this exon has one. */
  cdsGStart?: number;
  cdsGEnd?: number;
  cdsEffStart?: number;
  cdsEffEnd?: number;
}

/**
 * One uncompressible region in the row's piecewise warp. Each blocker
 * is the union of overlapping exon + feature intervals; consecutive
 * blockers are separated by `IntronSegment` entries (compressed or
 * not). Inside a blocker the `g → eff` map runs at slope 1, so
 * `genomicToEff` resolves any coord within a feature region (whether
 * or not the feature touches an exon) to the right effective x.
 */
export interface BlockerSegment {
  gStart: number;
  gEnd: number;
  effStart: number;
  effEnd: number;
}

export interface IntronSegment {
  /** Stable key per (row, intron) — drives override toggling. */
  key: string;
  gStart: number;
  gEnd: number;
  effStart: number;
  effEnd: number;
  realLength: number;
  isCompressed: boolean;
}

export interface RowLayout {
  exons: ExonSegment[];
  introns: IntronSegment[];
  /** Merged uncompressible regions (exons ∪ visible features). Used
   *  by `genomicToEff` so coords inside a feature-only sub-range
   *  still map at slope 1. */
  blockers: BlockerSegment[];
  /** Effective extent of the rendered window. */
  effMin: number;
  effMax: number;
  /** Real genomic extent of the rendered window. */
  gMin: number;
  gMax: number;
  startCodonEff?: number;
  stopCodonEff?: number;
  startCodonGenomic?: number;
  stopCodonGenomic?: number;
  peptideLength?: number;
  cdsLength?: number;
}

export interface BuildRowLayoutOpts {
  geneStructure: GeneStructure;
  transcript: Transcript;
  paddingMode: 'cds' | 'gene' | 'kb';
  paddingKb?: number;
  overrideKeys: ReadonlySet<string>;
  compressDefault: boolean;
  /** Stable per-row prefix used inside gap keys. */
  rowKey: string;
  /**
   * Visible genome features. Treated as additional uncompressible
   * regions when deciding gap compression — a feature spanning what
   * would otherwise be a long intron prevents that intron from
   * collapsing, so the feature stays at full readable width. The
   * caller should pre-filter to only the kinds the user wants
   * displayed (per `visibleFeatureKinds`); features filtered out at
   * render time should NOT be passed in here, otherwise hidden
   * features would silently keep their gaps from compressing.
   */
  features?: GenomeFeature[];
}

/**
 * Build the per-row layout in genomic + effective coordinates. The
 * caller maps effective coords to pixels using a single `pxPerEff`
 * scale; long introns are pre-compressed in effective space so this
 * scale stays constant across the row.
 */
export function buildRowLayout(opts: BuildRowLayoutOpts): RowLayout {
  const {
    geneStructure,
    transcript,
    paddingMode,
    paddingKb = 2,
    overrideKeys,
    compressDefault,
    rowKey,
    features,
  } = opts;
  const strand = geneStructure.strand;
  const cdsMap = buildCdsMap(transcript, strand);

  let gMin: number;
  let gMax: number;
  if (paddingMode === 'cds' && cdsMap) {
    gMin = Math.min(cdsMap.startCodonGenomic, cdsMap.stopCodonGenomic);
    gMax = Math.max(cdsMap.startCodonGenomic, cdsMap.stopCodonGenomic);
  } else if (paddingMode === 'kb') {
    gMin = geneStructure.start - Math.round(paddingKb * 1000);
    gMax = geneStructure.end + Math.round(paddingKb * 1000);
  } else {
    gMin = geneStructure.start;
    gMax = geneStructure.end;
  }

  const sortedExons = [...transcript.exons]
    .map((e, originalIndex) => ({ ...e, originalIndex }))
    .sort((a, b) => a.start - b.start);
  const visibleExons = sortedExons.filter(
    (e) => e.end >= gMin && e.start <= gMax,
  );

  // Build the merged "uncompressible" set: every visible exon plus
  // every visible feature, clipped to the window. The gaps BETWEEN
  // adjacent merged blockers are the only candidates for compression.
  // A regulatory element overlapping a long intron will therefore
  // prevent the intron from collapsing, leaving the feature visible
  // at its full width.
  type Interval = { gStart: number; gEnd: number };
  const blockers: Interval[] = [];
  for (const e of visibleExons) {
    blockers.push({
      gStart: Math.max(e.start, gMin),
      gEnd: Math.min(e.end, gMax),
    });
  }
  if (features) {
    for (const f of features) {
      if (f.end < gMin || f.start > gMax) continue;
      blockers.push({
        gStart: Math.max(f.start, gMin),
        gEnd: Math.min(f.end, gMax),
      });
    }
  }
  blockers.sort((a, b) => a.gStart - b.gStart);
  const merged: Interval[] = [];
  for (const iv of blockers) {
    const prev = merged[merged.length - 1];
    // Adjacent intervals (gap of 0) collapse into one — keeps the
    // gap-finding loop from emitting 0-length entries.
    if (!prev || iv.gStart > prev.gEnd + 1) {
      merged.push({ gStart: iv.gStart, gEnd: iv.gEnd });
    } else if (iv.gEnd > prev.gEnd) {
      prev.gEnd = iv.gEnd;
    }
  }

  // First pass — emit one IntronSegment per gap between merged
  // blockers, deciding compression up front. Track the running
  // savings so the second pass can map each exon's eff coords by
  // subtracting the savings accumulated up to that exon's gStart.
  const introns: IntronSegment[] = [];
  let compressed = 0;
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const curr = merged[i];
    const gStart = prev.gEnd + 1;
    const gEnd = curr.gStart - 1;
    const realLen = gEnd - gStart + 1;
    if (realLen <= 0) continue;
    // Key on genomic coords so toggles survive feature visibility
    // changes that don't shift this particular gap. If the gap's
    // boundaries DO shift (a feature appearing/disappearing inside
    // the gap), the key resets — acceptable since the gap topology
    // changed underneath the user.
    const key = `${rowKey}:gap:${gStart}-${gEnd}`;
    const isLong = realLen > LONG_INTRON_THRESHOLD_NT;
    const overridden = overrideKeys.has(key);
    const isCompressed = isLong && compressDefault !== overridden;
    const effStart = gStart - compressed;
    if (isCompressed) {
      compressed += realLen - COMPRESSED_INTRON_NT;
    }
    const effEnd = gEnd - compressed;
    introns.push({
      key,
      gStart,
      gEnd,
      effStart,
      effEnd,
      realLength: realLen,
      isCompressed,
    });
  }

  // Map merged blockers (exons ∪ features) and exons through the
  // warp. `g→eff` slope is 1 inside any blocker; the accumulator
  // advances only across compressed gaps that fully precede the
  // current segment. Both passes walk the same `introns` list
  // because blockers and introns alternate by construction.
  const blockerSegments: BlockerSegment[] = [];
  let bCompressed = 0;
  let bIntronIdx = 0;
  for (const m of merged) {
    while (
      bIntronIdx < introns.length &&
      introns[bIntronIdx].gEnd < m.gStart
    ) {
      const it = introns[bIntronIdx];
      if (it.isCompressed) {
        bCompressed += it.realLength - COMPRESSED_INTRON_NT;
      }
      bIntronIdx++;
    }
    blockerSegments.push({
      gStart: m.gStart,
      gEnd: m.gEnd,
      effStart: m.gStart - bCompressed,
      effEnd: m.gEnd - bCompressed,
    });
  }

  const exonSegments: ExonSegment[] = [];
  let exonCompressed = 0;
  let intronIdx = 0;
  for (const e of visibleExons) {
    const eStart = Math.max(e.start, gMin);
    const eEnd = Math.min(e.end, gMax);
    while (
      intronIdx < introns.length &&
      introns[intronIdx].gEnd < eStart
    ) {
      const it = introns[intronIdx];
      if (it.isCompressed) {
        exonCompressed += it.realLength - COMPRESSED_INTRON_NT;
      }
      intronIdx++;
    }
    const effStart = eStart - exonCompressed;
    const effEnd = eEnd - exonCompressed;
    let cdsGStart: number | undefined;
    let cdsGEnd: number | undefined;
    let cdsEffStart: number | undefined;
    let cdsEffEnd: number | undefined;
    if (e.cdsStart !== undefined && e.cdsEnd !== undefined) {
      const cs = Math.max(e.cdsStart, eStart);
      const ce = Math.min(e.cdsEnd, eEnd);
      if (ce >= cs) {
        cdsGStart = cs;
        cdsGEnd = ce;
        cdsEffStart = cs - exonCompressed;
        cdsEffEnd = ce - exonCompressed;
      }
    }
    exonSegments.push({
      exonIndex: e.originalIndex,
      gStart: eStart,
      gEnd: eEnd,
      effStart,
      effEnd,
      cdsGStart,
      cdsGEnd,
      cdsEffStart,
      cdsEffEnd,
    });
  }

  const effMin = gMin;
  const effMax = gMax - compressed;

  let startCodonEff: number | undefined;
  let stopCodonEff: number | undefined;
  if (cdsMap) {
    for (const seg of exonSegments) {
      if (
        cdsMap.startCodonGenomic >= seg.gStart &&
        cdsMap.startCodonGenomic <= seg.gEnd
      ) {
        startCodonEff =
          seg.effStart + (cdsMap.startCodonGenomic - seg.gStart);
      }
      if (
        cdsMap.stopCodonGenomic >= seg.gStart &&
        cdsMap.stopCodonGenomic <= seg.gEnd
      ) {
        stopCodonEff =
          seg.effStart + (cdsMap.stopCodonGenomic - seg.gStart);
      }
    }
  }

  return {
    exons: exonSegments,
    introns,
    blockers: blockerSegments,
    effMin,
    effMax,
    gMin,
    gMax,
    startCodonEff,
    stopCodonEff,
    startCodonGenomic: cdsMap?.startCodonGenomic,
    stopCodonGenomic: cdsMap?.stopCodonGenomic,
    peptideLength: cdsMap?.peptideLength,
    cdsLength: cdsMap?.cdsLength,
  };
}

/**
 * Map a genomic coordinate into the row's effective-coordinate space,
 * honouring intron compression.
 *
 * The row's transformation is piecewise linear: exons and uncompressed
 * introns map at slope 1; compressed introns squash a long real
 * interval into a short effective interval at slope
 * `(COMPRESSED_INTRON_NT / realLength)`. Padding regions outside the
 * outermost exons map at slope 1 (they sit before the first / after
 * the last accumulated compression step). Coords outside `[gMin, gMax]`
 * are projected with slope 1 off the nearest edge, which is what the
 * renderer wants for genome features that lie just past the rendered
 * window — they appear in line with the padding region.
 *
 * Used by the genome zone to place `genomeFeatures` (regulatory
 * elements, motifs, etc.) on the correct effective-x so they sit on
 * top of the matching exon / intron / padding region instead of
 * being smeared by a single uniform linear map.
 */
export function genomicToEff(layout: RowLayout, g: number): number {
  // Inside any uncompressible region — exon, feature, or merged
  // exon+feature — slope is 1.
  for (const b of layout.blockers) {
    if (g >= b.gStart && g <= b.gEnd) {
      return b.effStart + (g - b.gStart);
    }
  }
  // Inside an intron — slope = effLen / realLen. For compressed
  // introns this collapses a long real interval into a short
  // effective interval; for short / uncompressed introns the slope
  // is 1.
  for (const it of layout.introns) {
    if (g >= it.gStart && g <= it.gEnd) {
      const realSpan = Math.max(1, it.gEnd - it.gStart);
      const effSpan = it.effEnd - it.effStart;
      return it.effStart + ((g - it.gStart) * effSpan) / realSpan;
    }
  }
  // 5' / 3' padding (or `g` past the rendered window). Project off
  // the outermost blocker at slope 1.
  if (layout.blockers.length > 0) {
    const first = layout.blockers[0];
    if (g < first.gStart) return first.effStart - (first.gStart - g);
    const last = layout.blockers[layout.blockers.length - 1];
    if (g > last.gEnd) return last.effEnd + (g - last.gEnd);
  }
  // Fallback when there are no blockers — shouldn't happen in practice
  // since the renderer skips rows with empty layouts, but stay safe
  // and project through the window.
  const realSpan = Math.max(1, layout.gMax - layout.gMin);
  const effSpan = layout.effMax - layout.effMin;
  return layout.effMin + ((g - layout.gMin) * effSpan) / realSpan;
}

/** Pick the canonical transcript from a gene structure, falling back
 *  to the first transcript if no canonical id matches. */
export function pickCanonicalTranscript(
  gs: GeneStructure,
): Transcript | null {
  if (gs.transcripts.length === 0) return null;
  const canonical = gs.transcripts.find(
    (t) => t.id === gs.canonicalTranscriptId,
  );
  return canonical ?? gs.transcripts[0];
}
