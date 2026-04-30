import { describe, expect, it } from 'vitest';
import { expandCigar, fromGrameneGene, fromGrameneGenetree } from './gramene';

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
          gene_description: 'DCL1',
          sequence: 'MKLV',
          cigar: '2M1D2M',
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
