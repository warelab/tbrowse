import { describe, expect, it } from 'vitest';
import {
  buildCdsMap,
  buildRowLayout,
  COMPRESSED_INTRON_NT,
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
});
