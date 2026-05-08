import { describe, expect, it } from 'vitest';
import {
  buildCdsMap,
  buildRowLayout,
  COMPRESSED_INTRON_NT,
  genomicToEff,
} from './layout';
import type { GeneStructure, Transcript } from '../../types';

const forwardTranscript: Transcript = {
  id: 't1',
  isCanonical: true,
  biotype: 'protein_coding',
  exons: [
    // 5'UTR (exon 1) + CDS start
    { start: 100, end: 200, cdsStart: 150, cdsEnd: 200 }, // 51 cds nt
    // CDS-only middle exon
    { start: 1000, end: 1099, cdsStart: 1000, cdsEnd: 1099 }, // 100 cds nt
    // CDS end + 3'UTR
    { start: 2000, end: 2200, cdsStart: 2000, cdsEnd: 2049 }, // 50 cds nt
  ],
};

const reverseTranscript: Transcript = {
  id: 't2',
  isCanonical: true,
  biotype: 'protein_coding',
  exons: [
    // 3'UTR + CDS end (transcript-order: this is exon 3)
    { start: 100, end: 200, cdsStart: 150, cdsEnd: 200 }, // 51 cds nt
    // middle exon
    { start: 1000, end: 1099, cdsStart: 1000, cdsEnd: 1099 }, // 100 cds nt
    // CDS start + 5'UTR (transcript-order: this is exon 1)
    { start: 2000, end: 2200, cdsStart: 2000, cdsEnd: 2049 }, // 50 cds nt
  ],
};

describe('buildCdsMap', () => {
  it('walks forward-strand exons low → high genomic', () => {
    const m = buildCdsMap(forwardTranscript, 1);
    expect(m).not.toBeNull();
    expect(m!.cdsLength).toBe(51 + 100 + 50);
    expect(m!.peptideLength).toBe(Math.floor(201 / 3));
    expect(m!.startCodonGenomic).toBe(150);
    expect(m!.stopCodonGenomic).toBe(2049);
  });

  it('walks reverse-strand exons high → low genomic', () => {
    const m = buildCdsMap(reverseTranscript, -1);
    expect(m).not.toBeNull();
    expect(m!.cdsLength).toBe(51 + 100 + 50);
    expect(m!.startCodonGenomic).toBe(2049); // largest CDS coord on - strand
    expect(m!.stopCodonGenomic).toBe(150);
  });

  it('returns null when no CDS info is present', () => {
    const t: Transcript = {
      id: 't',
      exons: [{ start: 100, end: 200 }],
    };
    expect(buildCdsMap(t, 1)).toBeNull();
  });
});

const fwdGene: GeneStructure = {
  region: '1',
  strand: 1,
  start: 100,
  end: 2200,
  canonicalTranscriptId: 't1',
  transcripts: [forwardTranscript],
};

describe('buildRowLayout', () => {
  it('compresses long introns by default and shrinks effective extent', () => {
    const layout = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    expect(layout.exons).toHaveLength(3);
    // Two long introns (>100 nt) — both compressed.
    const longIntrons = layout.introns.filter(
      (i) => i.realLength > COMPRESSED_INTRON_NT,
    );
    expect(longIntrons).toHaveLength(2);
    expect(longIntrons.every((i) => i.isCompressed)).toBe(true);
    // Each compressed intron saves (realLen - 100) effective nt; effective
    // extent shrinks by exactly that total.
    const totalSaved = longIntrons.reduce(
      (s, i) => s + (i.realLength - COMPRESSED_INTRON_NT),
      0,
    );
    expect(layout.effMax - layout.effMin).toBe(
      layout.gMax - layout.gMin - totalSaved,
    );
  });

  it('expands an intron when its key is in the override set (XOR)', () => {
    const all = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    const firstKey = all.introns[0].key;
    const flipped = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set([firstKey]),
      compressDefault: true,
      rowKey: 'r',
    });
    const flippedFirst = flipped.introns.find((i) => i.key === firstKey)!;
    expect(flippedFirst.isCompressed).toBe(false);
  });

  it('positions start/stop codons correctly on forward strand', () => {
    const layout = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    expect(layout.startCodonGenomic).toBe(150);
    expect(layout.stopCodonGenomic).toBe(2049);
    // Start codon sits inside the first exon, before any compression.
    expect(layout.startCodonEff).toBe(150);
    // Stop codon sits inside the last exon, after both introns compressed.
    const totalSaved = layout.introns.reduce(
      (s, i) => s + (i.isCompressed ? i.realLength - COMPRESSED_INTRON_NT : 0),
      0,
    );
    expect(layout.stopCodonEff).toBe(2049 - totalSaved);
  });

  it("widens window in 'kb' padding mode", () => {
    const layout = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'kb',
      paddingKb: 2,
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    expect(layout.gMin).toBe(100 - 2000);
    expect(layout.gMax).toBe(2200 + 2000);
  });

  it("'cds' padding mode trims the window to the coding span", () => {
    const layout = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'cds',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    expect(layout.gMin).toBe(150);
    expect(layout.gMax).toBe(2049);
  });

  it('lets a feature spanning a long intron block its compression', () => {
    // First intron sits at 201..999 (real length 799, > 100 nt threshold).
    const noFeatures = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
    });
    const firstIntronNoFeat = noFeatures.introns[0];
    expect(firstIntronNoFeat.isCompressed).toBe(true);

    // Drop a feature that spans the entirety of the first intron and
    // overlaps the flanking exons. The merger should treat exon1 +
    // feature + exon2 as one big blocker, leaving NO compressible
    // gap between them.
    const withFeature = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
      features: [
        { id: 'f1', kind: 'TFBS', start: 150, end: 1050 },
      ],
    });
    // The original first-intron gap is gone (merged into the blocker)
    // — the only remaining gap should be the SECOND intron at
    // 1100..1999.
    const compressed = withFeature.introns.filter((i) => i.isCompressed);
    expect(compressed).toHaveLength(1);
    expect(compressed[0].gStart).toBeGreaterThanOrEqual(1100);
  });

  it('still compresses gaps between disjoint features', () => {
    // Two short features that DON'T span the gap between exons —
    // the long intron remains compressible because the feature
    // doesn't bridge the exons.
    const layout = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
      features: [{ id: 'f-short', kind: 'TFBS', start: 250, end: 260 }],
    });
    // First-exon-end is at 200; this feature starts at 250 leaving a
    // 49 nt gap (short) but the gap from 261..999 is still 739 nt
    // (long), so it should still compress.
    const compressed = layout.introns.filter((i) => i.isCompressed);
    expect(compressed.length).toBeGreaterThan(0);
  });
});

describe('genomicToEff', () => {
  const layout = buildRowLayout({
    geneStructure: fwdGene,
    transcript: forwardTranscript,
    paddingMode: 'gene',
    overrideKeys: new Set(),
    compressDefault: true,
    rowKey: 'r',
  });

  it('maps exon-interior coords with slope 1', () => {
    const e = layout.exons[0];
    expect(genomicToEff(layout, e.gStart)).toBe(e.effStart);
    expect(genomicToEff(layout, e.gEnd)).toBe(e.effEnd);
    // Midway through the exon
    const mid = Math.floor((e.gStart + e.gEnd) / 2);
    expect(genomicToEff(layout, mid)).toBe(e.effStart + (mid - e.gStart));
  });

  it('squashes a compressed intron to its effective span', () => {
    // First intron in the forward gene: realLength 800, compressed to 100.
    const intron = layout.introns.find((i) => i.isCompressed);
    expect(intron).toBeDefined();
    expect(intron!.realLength).toBeGreaterThan(COMPRESSED_INTRON_NT);
    const startEff = genomicToEff(layout, intron!.gStart);
    const endEff = genomicToEff(layout, intron!.gEnd);
    expect(startEff).toBe(intron!.effStart);
    expect(endEff).toBe(intron!.effEnd);
    // A coord halfway through the intron should land halfway through
    // the squashed eff interval — NOT at half the real-coord ratio.
    const midG = Math.floor((intron!.gStart + intron!.gEnd) / 2);
    const midEff = genomicToEff(layout, midG);
    const midRatio = (midEff - intron!.effStart) /
      (intron!.effEnd - intron!.effStart);
    expect(midRatio).toBeCloseTo(0.5, 3);
    // And the squashed eff span is much smaller than the real span.
    expect(intron!.effEnd - intron!.effStart).toBeLessThan(
      (intron!.gEnd - intron!.gStart) / 4,
    );
  });

  it('maps feature-region coords at slope 1 (matching exon mapping)', () => {
    // A feature wholly inside what would otherwise be a long intron.
    // With the feature acting as a blocker, the bracketing gaps
    // remain compressible but the FEATURE'S OWN region stays
    // uncompressed — coords inside the feature should map at slope
    // 1, not via the linear-fallback ratio.
    const layoutWithFeature = buildRowLayout({
      geneStructure: fwdGene,
      transcript: forwardTranscript,
      paddingMode: 'gene',
      overrideKeys: new Set(),
      compressDefault: true,
      rowKey: 'r',
      features: [{ id: 'f', kind: 'TFBS', start: 500, end: 600 }],
    });
    const fStart = genomicToEff(layoutWithFeature, 500);
    const fEnd = genomicToEff(layoutWithFeature, 600);
    // 600 - 500 = 100 nt, slope 1 ⇒ 100 eff units. The old linear
    // fallback would have used (effMax-effMin)/(gMax-gMin) which is
    // far less than 1.
    expect(fEnd - fStart).toBe(100);
    // And both endpoints should land OUTSIDE every intron's eff
    // interval — they sit on the feature's own blocker segment.
    for (const it of layoutWithFeature.introns) {
      expect(fStart < it.effStart || fStart > it.effEnd).toBe(true);
      expect(fEnd < it.effStart || fEnd > it.effEnd).toBe(true);
    }
  });

  it('maps adjacent exons monotonically across the intron compression', () => {
    // Coords increase monotonically through gMin → gMax → effMax.
    const samples = [];
    for (let g = layout.gMin; g <= layout.gMax; g += 50) {
      samples.push(genomicToEff(layout, g));
    }
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });
});
