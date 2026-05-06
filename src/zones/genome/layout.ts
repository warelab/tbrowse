import type { GeneStructure, Transcript } from '../../types';

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
  /** Stable per-row prefix used inside intron keys. */
  rowKey: string;
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

  const introns: IntronSegment[] = [];
  const exonSegments: ExonSegment[] = [];
  let compressed = 0;

  for (let i = 0; i < visibleExons.length; i++) {
    const e = visibleExons[i];
    const eStart = Math.max(e.start, gMin);
    const eEnd = Math.min(e.end, gMax);

    if (i > 0) {
      const prev = visibleExons[i - 1];
      const intronGStart = Math.max(prev.end + 1, gMin);
      const intronGEnd = Math.min(e.start - 1, gMax);
      const realLen = Math.max(0, intronGEnd - intronGStart + 1);
      if (realLen > 0) {
        const key = `${rowKey}:intron:${prev.originalIndex}-${e.originalIndex}`;
        const isLong = realLen > LONG_INTRON_THRESHOLD_NT;
        const overridden = overrideKeys.has(key);
        const isCompressed = isLong && compressDefault !== overridden;
        const effStart = intronGStart - compressed;
        if (isCompressed) {
          compressed += realLen - COMPRESSED_INTRON_NT;
        }
        const effEnd = intronGEnd - compressed;
        introns.push({
          key,
          gStart: intronGStart,
          gEnd: intronGEnd,
          effStart,
          effEnd,
          realLength: realLen,
          isCompressed,
        });
      }
    }

    const effStart = eStart - compressed;
    const effEnd = eEnd - compressed;
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
        cdsEffStart = cs - compressed;
        cdsEffEnd = ce - compressed;
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
