import { describe, expect, it } from 'vitest';
import { fromEnsemblGeneStructure, fromEnsemblGenomeFeatures } from '../../src/adapters';
import fixture from '../fixtures/adapters/ensembl-overlap.json';

// Fixture summary (see test/fixtures/adapters/ensembl-overlap.json): one
// `/overlap/id/ENSG1` style array mixing
//   - the gene row itself,
//   - two ENSG1 transcripts: ENST1 (canonical, exons 100..150 + 200..300
//     given out of order, CDS segments 120..150 + 200..260) and ENST2
//     (retained_intron, one exon 150..400, no CDS),
//   - a transcript + exon belonging to a neighbouring gene (ENSG_OTHER),
//   - a regulatory row, a motif row, and a regulatory row missing `end`.

describe('fromEnsemblGeneStructure', () => {
  const gs = fromEnsemblGeneStructure(fixture, 'ENSG1')!;

  it('returns null for non-arrays and for genes with no transcripts in the response', () => {
    expect(fromEnsemblGeneStructure({ error: 'x' }, 'ENSG1')).toBeNull();
    expect(fromEnsemblGeneStructure(fixture, 'ENSG_ABSENT')).toBeNull();
  });

  it('scopes to transcripts whose Parent is the requested gene', () => {
    expect(gs.transcripts.map((t) => t.id)).toEqual(['ENST1', 'ENST2']);
    // The neighbouring gene's transcript is still reachable by its own id.
    expect(fromEnsemblGeneStructure(fixture, 'ENSG_OTHER')!.transcripts.map((t) => t.id)).toEqual([
      'ENSTX',
    ]);
  });

  it('derives region, strand and the gene span from the transcripts', () => {
    expect(gs.region).toBe('7');
    expect(gs.strand).toBe(1);
    expect(gs.start).toBe(100);
    expect(gs.end).toBe(400);
  });

  it('strips the -NNN transcript suffix from external_name', () => {
    expect(gs.name).toBe('ABC');
  });

  it('sorts exons by start and intersects CDS segments per exon', () => {
    const t1 = gs.transcripts[0]!;
    expect(t1.exons).toEqual([
      { start: 100, end: 150, cdsStart: 120, cdsEnd: 150 },
      { start: 200, end: 300, cdsStart: 200, cdsEnd: 260 },
    ]);
    expect(t1.biotype).toBe('protein_coding');
    const t2 = gs.transcripts[1]!;
    expect(t2.exons).toEqual([{ start: 150, end: 400 }]);
    expect(t2.exons[0]).not.toHaveProperty('cdsStart');
    expect(t2.biotype).toBe('retained_intron');
  });

  it('uses the is_canonical flag when present', () => {
    expect(gs.canonicalTranscriptId).toBe('ENST1');
    expect(gs.transcripts[0]!.isCanonical).toBe(true);
    expect(gs.transcripts[1]!.isCanonical).toBe(false);
  });

  it('falls back to the longest CDS when no transcript is flagged canonical', () => {
    const unflagged = (fixture as Array<Record<string, unknown>>).map((row) => {
      const { is_canonical: _drop, ...rest } = row;
      return rest;
    });
    const out = fromEnsemblGeneStructure(unflagged, 'ENSG1')!;
    expect(out.canonicalTranscriptId).toBe('ENST1');
    expect(out.transcripts[0]!.isCanonical).toBe(true);
    expect(out.transcripts[1]!.isCanonical).toBe(false);
  });

  it('breaks CDS-length ties by total exon length', () => {
    const rows = [
      { id: 'T1', feature_type: 'transcript', Parent: 'G', start: 1, end: 10, strand: -1, seq_region_name: 'X' },
      { id: 'T2', feature_type: 'transcript', Parent: 'G', start: 1, end: 30, strand: -1, seq_region_name: 'X' },
      { id: 'E1', feature_type: 'exon', Parent: 'T1', start: 1, end: 10 },
      { id: 'E2', feature_type: 'exon', Parent: 'T2', start: 1, end: 30 },
    ];
    const out = fromEnsemblGeneStructure(rows, 'G')!;
    expect(out.strand).toBe(-1);
    expect(out.canonicalTranscriptId).toBe('T2');
    // No external_name on either transcript → no `name` key at all.
    expect(out).not.toHaveProperty('name');
  });
});

describe('fromEnsemblGenomeFeatures', () => {
  it('returns [] for a non-array payload', () => {
    expect(fromEnsemblGenomeFeatures(null)).toEqual([]);
  });

  it('skips gene-structure rows and malformed rows, keeping regulatory and motif features', () => {
    const out = fromEnsemblGenomeFeatures(fixture);
    expect(out).toEqual([
      {
        id: 'ENSR1',
        kind: 'Promoter',
        start: 50,
        end: 120,
        label: 'Predicted promoter',
      },
      {
        id: 'ENSM1',
        kind: 'motif_feature',
        start: 130,
        end: 140,
        strand: -1,
        label: 'ENSPFM0001',
      },
    ]);
    // Row without a strand carries no `strand` key.
    expect(out[0]).not.toHaveProperty('strand');
  });

  it('falls back through feature_type_class and feature_type for kind and label', () => {
    const out = fromEnsemblGenomeFeatures([
      { id: 'A', feature_type: 'repeat', start: 1, end: 2, strand: 0 },
      { id: 'B', feature_type_class: '', feature_type: '', start: 3, end: 4 },
    ]);
    expect(out).toEqual([
      { id: 'A', kind: 'repeat', start: 1, end: 2, label: 'repeat' },
      { id: 'B', kind: 'feature', start: 3, end: 4 },
    ]);
  });
});
