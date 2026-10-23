import { describe, expect, it } from 'vitest';
import { fromGrameneGeneStructures } from '../../src/adapters';
import fixture from '../fixtures/adapters/gramene-gene-structures.json';

// Fixture summary (see test/fixtures/adapters/gramene-gene-structures.json):
//
//   GA  forward strand, gene 1000..1099. Exons relative to the 5' end:
//       e1 1..20, e2 41..70, e3 81..100. Transcript GA.1 = e1+e2+e3 with a
//       CDS at cDNA 11..60; a second, non-coding transcript = e1+e3 with no
//       translation id (so it gets a synthesised id). No canonical_transcript
//       → the longest-CDS rule must pick GA.1.
//   GB  reverse strand, gene 5000..5059. Exons x1 1..10, x2 31..60. GB.1 =
//       x1+x2, CDS 5..35 (31 bp); GB.2 = x2 alone, CDS 1..30 (30 bp).
//       canonical_transcript names GB.2 even though GB.1 has the longer CDS.
//   GC  has a location but no gene_structure → skipped.

describe('fromGrameneGeneStructures', () => {
  const out = fromGrameneGeneStructures(fixture);

  it('returns one structure per well-formed doc and skips the rest', () => {
    expect(Object.keys(out).sort()).toEqual(['GA', 'GB']);
    expect(fromGrameneGeneStructures(null)).toEqual({});
    expect(fromGrameneGeneStructures([{ _id: 'X' }, {}])).toEqual({});
  });

  it('copies the gene span, region, strand and name', () => {
    expect(out.GA).toMatchObject({
      region: '1',
      strand: 1,
      start: 1000,
      end: 1099,
      name: 'GeneA',
    });
    expect(out.GB).toMatchObject({ region: '2', strand: -1, start: 5000, end: 5059 });
    // No `name` on the doc → the key is absent rather than undefined.
    expect(out.GB).not.toHaveProperty('name');
  });

  it('converts forward-strand relative exon coords to absolute genomic coords with per-exon CDS bounds', () => {
    const ga = out.GA!;
    const t1 = ga.transcripts.find((t) => t.id === 'GA.1')!;
    // cDNA layout: e1 → 1..20, e2 → 21..50, e3 → 51..70; CDS 11..60.
    expect(t1.exons).toEqual([
      { start: 1000, end: 1019, cdsStart: 1010, cdsEnd: 1019 },
      { start: 1040, end: 1069, cdsStart: 1040, cdsEnd: 1069 },
      { start: 1080, end: 1099, cdsStart: 1080, cdsEnd: 1089 },
    ]);
    // A transcript with a usable `cds` is reported as protein_coding.
    expect(t1.biotype).toBe('protein_coding');
  });

  it('synthesises a transcript id when translation.id is absent and leaves non-coding exons without CDS bounds', () => {
    const ga = out.GA!;
    expect(ga.transcripts.map((t) => t.id)).toEqual(['GA.1', 'GA_t2']);
    const t2 = ga.transcripts[1]!;
    expect(t2.biotype).toBe('retained_intron');
    expect(t2.exons).toEqual([
      { start: 1000, end: 1019 },
      { start: 1080, end: 1099 },
    ]);
    expect(t2.exons[0]).not.toHaveProperty('cdsStart');
    expect(t2.exons[0]).not.toHaveProperty('cdsEnd');
  });

  it('picks the longest-CDS transcript as canonical when canonical_transcript is absent', () => {
    const ga = out.GA!;
    expect(ga.canonicalTranscriptId).toBe('GA.1');
    expect(ga.transcripts[0]!.isCanonical).toBe(true);
    expect(ga.transcripts[1]!.isCanonical).toBeUndefined();
  });

  it('mirrors reverse-strand exons off the gene 3\' end and sorts them genomic-ascending', () => {
    const gb = out.GB!;
    const t1 = gb.transcripts.find((t) => t.id === 'GB.1')!;
    // x1 (rel 1..10)  → 5050..5059, cDNA 1..10;  CDS overlap 5..10  → 5050..5055
    // x2 (rel 31..60) → 5000..5029, cDNA 11..40; CDS overlap 11..35 → 5005..5029
    expect(t1.exons).toEqual([
      { start: 5000, end: 5029, cdsStart: 5005, cdsEnd: 5029 },
      { start: 5050, end: 5059, cdsStart: 5050, cdsEnd: 5055 },
    ]);
    const t2 = gb.transcripts.find((t) => t.id === 'GB.2')!;
    expect(t2.exons).toEqual([{ start: 5000, end: 5029, cdsStart: 5000, cdsEnd: 5029 }]);
  });

  it('honours canonical_transcript over the longest-CDS rule', () => {
    const gb = out.GB!;
    expect(gb.canonicalTranscriptId).toBe('GB.2');
    expect(gb.transcripts.find((t) => t.id === 'GB.2')!.isCanonical).toBe(true);
    expect(gb.transcripts.find((t) => t.id === 'GB.1')!.isCanonical).toBeUndefined();
  });

  it('falls back to the first transcript when canonical_transcript names an unknown id', () => {
    const doc = JSON.parse(JSON.stringify(fixture[1])) as { canonical_transcript: string };
    doc.canonical_transcript = 'GB.nope';
    const gb = fromGrameneGeneStructures([doc]).GB!;
    expect(gb.canonicalTranscriptId).toBe('GB.1');
  });

  it('breaks CDS-length ties by total exon length', () => {
    const doc = {
      _id: 'GT',
      location: { region: '9', start: 1, end: 100, strand: 1 },
      gene_structure: {
        exons: [
          { id: 'a', start: 1, end: 10 },
          { id: 'b', start: 1, end: 30 },
        ],
        transcripts: [
          { exons: ['a'], translation: { id: 'short' } },
          { exons: ['b'], translation: { id: 'long' } },
        ],
      },
    };
    expect(fromGrameneGeneStructures([doc]).GT!.canonicalTranscriptId).toBe('long');
  });
});
