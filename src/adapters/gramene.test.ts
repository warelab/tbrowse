import { describe, expect, it } from 'vitest';
import {
  expandCigar,
  fromGrameneGene,
  fromGrameneGenetree,
  fromGrameneNeighborhood,
} from './gramene';

describe('expandCigar', () => {
  it('returns the unaligned sequence when cigar is empty', () => {
    expect(expandCigar('MKLV', '')).toBe('MKLV');
  });

  it('expands match-then-gap-then-match', () => {
    expect(expandCigar('MKLV', '2M1D2M')).toBe('MK-LV');
  });

  it('handles all-match', () => {
    expect(expandCigar('ABCDEF', '6M')).toBe('ABCDEF');
  });

  it('handles all-gap (no residues consumed)', () => {
    expect(expandCigar('ABC', '5D')).toBe('-----');
  });

  it('treats omitted run-length as 1', () => {
    expect(expandCigar('AB', 'MDM')).toBe('A-B');
  });
});

describe('fromGrameneGenetree', () => {
  // Trimmed example mirroring the genetree response shape (one root with
  // one duplication node holding two leaves on different species).
  const sample = [
    {
      _id: 'EPlGT00940000166940',
      tree_stable_id: 'EPlGT00940000166940',
      node_id: 1,
      distance_to_parent: 0,
      taxon_id: 33090,
      taxon_name: 'Viridiplantae',
      node_type: 'speciation',
      bootstrap: 100,
      children: [
        {
          node_id: 2,
          distance_to_parent: 0.05,
          taxon_id: 3702001,
          taxon_name: 'Arabidopsis thaliana',
          system_name: 'arabidopsis_thaliana',
          gene_stable_id: 'AT1G01040',
          protein_stable_id: 'AT1G01040.1',
          gene_description: 'Dicer-like protein 1',
          gene_display_label: 'DCL1',
          sequence: 'MKLV',
          cigar: '2M1D2M',
          exon_junctions: [2, 3, 0, -1, 'bad' as unknown as number, 2],
          domains: [
            {
              id: 'IPR000999',
              root: 999,
              start: 1,
              end: 4,
              name: 'RNase III',
              description: 'Ribonuclease III domain',
            },
          ],
        },
        {
          node_id: 3,
          distance_to_parent: 0.06,
          taxon_id: 4577001,
          taxon_name: 'Zea mays',
          system_name: 'zea_mays',
          gene_stable_id: 'Zm00001eb000010',
          protein_stable_id: 'Zm00001eb000010_T001',
          sequence: 'MKLLV',
          cigar: '5M',
          domains: [
            { id: 'IPR000999', root: 999, start: 2, end: 5, name: 'RNase III' },
            // Skipped: missing start/end.
            { id: 'IPRBROKEN', root: 1 },
          ],
        },
      ],
    },
  ];

  it('builds a tree with synthetic preorder ids', () => {
    const { tree } = fromGrameneGenetree(sample);
    expect(tree.rootId).toBe('n0');
    expect(Object.keys(tree.nodes).sort()).toEqual(['n0', 'n1', 'n2']);
    expect(tree.nodes.n0.parentId).toBeNull();
    expect(tree.nodes.n1.parentId).toBe('n0');
    expect(tree.nodes.n2.parentId).toBe('n0');
    expect(tree.nodes.n0.eventType).toBe('speciation');
    expect(tree.nodes.n0.bootstrap).toBe(100);
  });

  it('expands CIGAR into the MSA, padding short rows', () => {
    const { msa } = fromGrameneGenetree(sample);
    expect(msa).not.toBeUndefined();
    expect(msa!.alphabet).toBe('protein');
    expect(msa!.sequences['AT1G01040']).toBe('MK-LV');
    expect(msa!.sequences['Zm00001eb000010']).toBe('MKLLV');
    expect(msa!.length).toBe(5);
  });

  it('captures protein domains keyed by gene id', () => {
    const { proteinDomains } = fromGrameneGenetree(sample);
    expect(proteinDomains['AT1G01040']).toEqual([
      {
        id: 'IPR000999',
        name: 'RNase III',
        start: 1,
        end: 4,
        source: 'InterPro',
      },
    ]);
    // Broken hit dropped, valid one kept.
    expect(proteinDomains['Zm00001eb000010']).toEqual([
      {
        id: 'IPR000999',
        name: 'RNase III',
        start: 2,
        end: 5,
        source: 'InterPro',
      },
    ]);
  });

  it('captures protein ids keyed by gene id', () => {
    const { proteinIdByGeneId } = fromGrameneGenetree(sample);
    expect(proteinIdByGeneId).toEqual({
      AT1G01040: 'AT1G01040.1',
      Zm00001eb000010: 'Zm00001eb000010_T001',
    });
  });

  it('uses gene_display_label as displayName on geneMetadata', () => {
    const { geneMetadata } = fromGrameneGenetree(sample);
    expect(geneMetadata['AT1G01040']).toMatchObject({
      displayName: 'DCL1',
      description: 'Dicer-like protein 1',
    });
    // Leaves without gene_display_label simply omit displayName.
    expect(geneMetadata['Zm00001eb000010']).not.toHaveProperty('displayName');
  });

  it('captures exon junctions keyed by gene id, dropping bad entries', () => {
    const { exonJunctions } = fromGrameneGenetree(sample);
    // The sample includes 0, -1, a non-numeric entry, and a duplicate
    // for AT1G01040 — only the positive numbers survive, deduped.
    expect(exonJunctions).toEqual({ AT1G01040: [2, 3] });
  });

  it('builds the taxonomy table from internal + leaf nodes', () => {
    const { taxonomy } = fromGrameneGenetree(sample);
    expect(taxonomy[33090].scientificName).toBe('Viridiplantae');
    expect(taxonomy[3702001].scientificName).toBe('Arabidopsis thaliana');
    expect(taxonomy[3702001].commonName).toBe('arabidopsis_thaliana');
  });

  it('throws on an empty payload', () => {
    expect(() => fromGrameneGenetree([])).toThrow(/non-empty array/);
  });
});

describe('fromGrameneGene', () => {
  const sample = [
    {
      _id: 'AT1G01040',
      taxon_id: 3702001,
      system_name: 'arabidopsis_thaliana',
      description: 'Dicer-like protein 1',
      homology: { gene_tree: { id: 'EPlGT00940000166940' } },
    },
  ];

  it('extracts gene id, tree id, taxonomy id', () => {
    expect(fromGrameneGene(sample)).toEqual({
      geneId: 'AT1G01040',
      geneTreeId: 'EPlGT00940000166940',
      taxonomyId: 3702001,
      systemName: 'arabidopsis_thaliana',
      description: 'Dicer-like protein 1',
    });
  });

  it('returns null geneTreeId when the gene has no tree assignment', () => {
    const withoutTree = [{ _id: 'X', taxon_id: 1 }];
    expect(fromGrameneGene(withoutTree).geneTreeId).toBeNull();
  });

  it('throws on an empty payload', () => {
    expect(() => fromGrameneGene([])).toThrow(/non-empty array/);
  });

  it('throws when _id is missing', () => {
    expect(() => fromGrameneGene([{}])).toThrow(/missing _id/);
  });
});

describe('fromGrameneNeighborhood', () => {
  // Five contiguous Arabidopsis chromosome-1 genes (gene_idx 100..104),
  // a sixth on chromosome 2, and a maize gene to confirm the
  // (system_name, region) grouping. Junk docs (no id / no gene_idx)
  // should be silently skipped.
  const sample = {
    response: {
      docs: [
        {
          id: 'AT1A',
          gene_idx: 100,
          region: '1',
          system_name: 'arabidopsis_thaliana',
          start: 1,
          end: 100,
          strand: 1,
          gene_tree: 'TR1',
        },
        {
          id: 'AT1B',
          gene_idx: 101,
          region: '1',
          system_name: 'arabidopsis_thaliana',
          start: 200,
          end: 300,
          strand: -1,
          gene_tree: 'TR2',
        },
        {
          id: 'AT1C',
          gene_idx: 102,
          region: '1',
          system_name: 'arabidopsis_thaliana',
          start: 400,
          end: 500,
          strand: 1,
          // No gene_tree → renders gray (undefined here).
        },
        {
          id: 'AT1D',
          gene_idx: 103,
          region: '1',
          system_name: 'arabidopsis_thaliana',
          start: 600,
          end: 700,
          strand: 1,
          gene_tree: 'TR1',
        },
        {
          id: 'AT2A',
          gene_idx: 200,
          region: '2',
          system_name: 'arabidopsis_thaliana',
          start: 1,
          end: 100,
          strand: 1,
          gene_tree: 'TR3',
        },
        {
          id: 'ZmA',
          gene_idx: 99,
          region: '1',
          system_name: 'zea_mays',
          start: 1,
          end: 100,
          strand: 1,
          gene_tree: 'TR1',
        },
        // Junk: missing id.
        { gene_idx: 999, region: '1', system_name: 'arabidopsis_thaliana' },
        // Junk: missing gene_idx.
        { id: 'AT1Junk', region: '1', system_name: 'arabidopsis_thaliana' },
      ],
    },
  };

  it('groups by (system_name, region) and indexes by gene_idx', () => {
    const out = fromGrameneNeighborhood(sample);
    // AT1B is between AT1A (upstream, gene_idx 100) and AT1C/AT1D
    // (downstream, gene_idx 102/103). The grouping ignores AT2A and ZmA.
    expect(out['AT1B'].center.id).toBe('AT1B');
    expect(out['AT1B'].upstream.map((g) => g.id)).toEqual(['AT1A']);
    expect(out['AT1B'].downstream.map((g) => g.id)).toEqual(['AT1C', 'AT1D']);
  });

  it('caps upstream + downstream at 10 each', () => {
    const docs: Array<{
      id: string;
      gene_idx: number;
      region: string;
      system_name: string;
    }> = [];
    for (let i = 0; i < 25; i++) {
      docs.push({
        id: `g${i}`,
        gene_idx: i,
        region: 'X',
        system_name: 'sp',
      });
    }
    const out = fromGrameneNeighborhood({ response: { docs } });
    // Centre at index 12: 10 on each side.
    expect(out['g12'].upstream.map((g) => g.id)).toEqual([
      'g2',
      'g3',
      'g4',
      'g5',
      'g6',
      'g7',
      'g8',
      'g9',
      'g10',
      'g11',
    ]);
    expect(out['g12'].downstream.map((g) => g.id)).toEqual([
      'g13',
      'g14',
      'g15',
      'g16',
      'g17',
      'g18',
      'g19',
      'g20',
      'g21',
      'g22',
    ]);
  });

  it('clamps short windows at chromosome edges', () => {
    const out = fromGrameneNeighborhood(sample);
    expect(out['AT1A'].upstream).toEqual([]);
    expect(out['AT1A'].downstream.map((g) => g.id)).toEqual(['AT1B', 'AT1C', 'AT1D']);
    // AT2A is alone in its region.
    expect(out['AT2A'].upstream).toEqual([]);
    expect(out['AT2A'].downstream).toEqual([]);
  });

  it('keeps gene fields, normalises strand, drops empty descriptions', () => {
    const out = fromGrameneNeighborhood({
      response: {
        docs: [
          {
            id: 'A',
            gene_idx: 1,
            region: '1',
            system_name: 's',
            strand: 5,
            description: '""',
            biotype: 'protein_coding',
            gene_tree: 'T1',
            name: 'AlphaName',
            start: 1,
            end: 100,
          },
          {
            id: 'B',
            gene_idx: 2,
            region: '1',
            system_name: 's',
            strand: -1,
            description: 'cool gene',
          },
        ],
      },
    });
    expect(out['A'].center.strand).toBe(1); // unknown strand → 1
    expect(out['A'].center.description).toBeUndefined(); // '""' dropped
    expect(out['A'].center.biotype).toBe('protein_coding');
    expect(out['A'].center.geneTree).toBe('T1');
    expect(out['A'].center.name).toBe('AlphaName');
    expect(out['B'].center.strand).toBe(-1);
    expect(out['B'].center.description).toBe('cool gene');
  });

  it('returns an empty map on garbage payload', () => {
    expect(fromGrameneNeighborhood(null)).toEqual({});
    expect(fromGrameneNeighborhood({ response: {} })).toEqual({});
  });
});
