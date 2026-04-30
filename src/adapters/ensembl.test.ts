import { describe, expect, it } from 'vitest';
import { fromEnsemblGeneTree, fromEnsemblProteinFeatures } from './ensembl';

const minimalResponse = {
  type: 'gene tree',
  rooted: 1,
  id: 'ENSGT00010000000001',
  tree: {
    branch_length: 0,
    confidence: {},
    events: { type: 'speciation' },
    taxonomy: { id: 7742, scientific_name: 'Vertebrata', common_name: 'Vertebrates' },
    children: [
      {
        branch_length: 0.05,
        confidence: { bootstrap: 92 },
        events: { type: 'duplication' },
        taxonomy: { id: 9347, scientific_name: 'Eutheria', common_name: 'Placental mammals' },
        children: [
          {
            branch_length: 0.01,
            confidence: {},
            taxonomy: { id: 9606, scientific_name: 'Homo sapiens', common_name: 'Human' },
            id: { accession: 'ENSG00000139618', source: 'EnsEMBL' },
            sequence: { mol_seq: { is_aligned: 1, seq: 'MPI--EYK' } },
          },
          {
            branch_length: 0.01,
            confidence: {},
            taxonomy: { id: 9598, scientific_name: 'Pan troglodytes', common_name: 'Chimpanzee' },
            id: { accession: 'ENSPTRG00000001', source: 'EnsEMBL' },
            sequence: { mol_seq: { is_aligned: 1, seq: 'MPIYNEYK' } },
          },
        ],
      },
      {
        branch_length: 0.06,
        confidence: {},
        taxonomy: { id: 7955, scientific_name: 'Danio rerio', common_name: 'Zebrafish' },
        id: { accession: 'ENSDARG00000001', source: 'EnsEMBL' },
        sequence: { mol_seq: { is_aligned: 1, seq: 'MAQ-----' } },
      },
    ],
  },
};

describe('fromEnsemblGeneTree', () => {
  it('produces a flat tree with synthetic preorder ids', () => {
    const { tree } = fromEnsemblGeneTree(minimalResponse);
    expect(tree.rootId).toBe('n0');
    expect(Object.keys(tree.nodes).sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4']);
    // Walk: root, eutheria, human, chimp, fish (preorder).
    expect(tree.nodes.n0.parentId).toBeNull();
    expect(tree.nodes.n1.parentId).toBe('n0');
    expect(tree.nodes.n2.parentId).toBe('n1');
    expect(tree.nodes.n3.parentId).toBe('n1');
    expect(tree.nodes.n4.parentId).toBe('n0');
  });

  it('translates snake_case fields and event types', () => {
    const { tree } = fromEnsemblGeneTree(minimalResponse);
    expect(tree.nodes.n0.eventType).toBe('speciation');
    expect(tree.nodes.n1.eventType).toBe('duplication');
    expect(tree.nodes.n1.bootstrap).toBe(92);
    expect(tree.nodes.n1.distance).toBeCloseTo(0.05);
    // Leaves carry geneId from id.accession.
    expect(tree.nodes.n2.geneId).toBe('ENSG00000139618');
    expect(tree.nodes.n2.taxonomyId).toBe(9606);
    expect(tree.nodes.n2.isLeaf).toBe(true);
  });

  it('builds the taxonomy table keyed by id', () => {
    const { taxonomy } = fromEnsemblGeneTree(minimalResponse);
    expect(taxonomy[7742].scientificName).toBe('Vertebrata');
    expect(taxonomy[9606].commonName).toBe('Human');
    expect(taxonomy[7955]).toEqual({
      scientificName: 'Danio rerio',
      commonName: 'Zebrafish',
    });
  });

  it('extracts MSA sequences keyed by gene id, padded to common length', () => {
    const { msa } = fromEnsemblGeneTree(minimalResponse);
    expect(msa).not.toBeUndefined();
    expect(msa!.length).toBe(8);
    expect(msa!.alphabet).toBe('protein');
    expect(msa!.sequences['ENSG00000139618']).toBe('MPI--EYK');
    expect(msa!.sequences['ENSPTRG00000001']).toBe('MPIYNEYK');
    expect(msa!.sequences['ENSDARG00000001']).toBe('MAQ-----');
  });

  it('detects DNA alphabet from sequence content', () => {
    const dnaResponse = {
      type: 'gene tree',
      tree: {
        branch_length: 0,
        children: [
          {
            branch_length: 1,
            id: { accession: 'gene-A' },
            sequence: { mol_seq: { is_aligned: 1, seq: 'ACGT-N' } },
          },
        ],
      },
    };
    const { msa } = fromEnsemblGeneTree(dnaResponse);
    expect(msa!.alphabet).toBe('dna');
  });

  it('honours options.alphabet override', () => {
    const dnaResponse = {
      type: 'gene tree',
      tree: {
        branch_length: 0,
        children: [
          {
            branch_length: 1,
            id: { accession: 'gene-A' },
            sequence: { mol_seq: { is_aligned: 1, seq: 'ACGT-N' } },
          },
        ],
      },
    };
    const { msa } = fromEnsemblGeneTree(dnaResponse, { alphabet: 'protein' });
    expect(msa!.alphabet).toBe('protein');
  });

  it('throws on a response with no tree', () => {
    expect(() => fromEnsemblGeneTree({})).toThrow(/not a valid Ensembl gene-tree response/);
  });

  it('captures the translation (ENSP) accession from sequence.id', () => {
    const withProteinIds = {
      type: 'gene tree',
      tree: {
        branch_length: 0,
        children: [
          {
            branch_length: 1,
            id: { accession: 'ENSG_HUMAN', source: 'EnsEMBL' },
            sequence: {
              id: [
                { accession: 'ENSP_HUMAN', source: 'Ensembl/GRCh38' },
                { accession: 'something-else', source: 'OtherDB' },
              ],
              mol_seq: { is_aligned: 1, seq: 'MK' },
            },
          },
          {
            branch_length: 1,
            id: { accession: 'ENSG_FISH', source: 'EnsEMBL' },
            // sequence.id as a single object instead of an array.
            sequence: {
              id: { accession: 'ENSDARP_FISH', source: 'Ensembl/GRCz11' },
              mol_seq: { is_aligned: 1, seq: 'MA' },
            },
          },
          {
            branch_length: 1,
            id: { accession: 'ENSG_RAT', source: 'EnsEMBL' },
            // No sequence.id at all — falls back to sequence.name when it
            // looks like an Ensembl protein accession.
            sequence: { name: 'ENSRNOP00000099', mol_seq: { is_aligned: 1, seq: 'MR' } },
          },
        ],
      },
    };
    const { proteinIdByGeneId } = fromEnsemblGeneTree(withProteinIds);
    expect(proteinIdByGeneId).toEqual({
      ENSG_HUMAN: 'ENSP_HUMAN',
      ENSG_FISH: 'ENSDARP_FISH',
      ENSG_RAT: 'ENSRNOP00000099',
    });
  });

  it('returns no MSA when no leaves have sequences', () => {
    const noSeq = {
      type: 'gene tree',
      tree: {
        branch_length: 0,
        children: [
          { branch_length: 1, id: { accession: 'a' } },
          { branch_length: 1, id: { accession: 'b' } },
        ],
      },
    };
    const { msa } = fromEnsemblGeneTree(noSeq);
    expect(msa).toBeUndefined();
  });
});

describe('fromEnsemblProteinFeatures', () => {
  // Trimmed example, mirroring the real /overlap/translation/{ENSP}
  // ?feature=protein_feature shape (extra fields elided).
  const sample = [
    {
      id: 'PF00069',
      hseqname: 'PF00069',
      type: 'Pfam',
      description: 'Protein kinase domain',
      interpro: 'IPR000719',
      start: 235,
      end: 481,
      feature_type: 'protein_feature',
    },
    {
      id: 'PF00130',
      type: 'Pfam',
      description: 'C1 domain',
      start: 235,
      end: 281,
      feature_type: 'protein_feature',
    },
    {
      id: 'SM00109',
      type: 'Smart',
      description: 'Smart C1',
      start: 240,
      end: 290,
      feature_type: 'protein_feature',
    },
    // Skipped: missing start/end.
    { id: 'X', type: 'Pfam', description: 'broken' },
    // Skipped: missing id.
    { type: 'Pfam', description: 'no id', start: 1, end: 10 },
  ];

  it('maps Ensembl rows to ProteinDomain shape', () => {
    const out = fromEnsemblProteinFeatures(sample);
    expect(out).toEqual([
      {
        id: 'PF00069',
        name: 'Protein kinase domain',
        start: 235,
        end: 481,
        source: 'Pfam',
      },
      { id: 'PF00130', name: 'C1 domain', start: 235, end: 281, source: 'Pfam' },
      { id: 'SM00109', name: 'Smart C1', start: 240, end: 290, source: 'Smart' },
    ]);
  });

  it('filters by source when options.sources is provided', () => {
    const out = fromEnsemblProteinFeatures(sample, { sources: ['Pfam'] });
    expect(out.map((d) => d.id)).toEqual(['PF00069', 'PF00130']);
  });

  it('falls back to id as the name when description is absent', () => {
    const out = fromEnsemblProteinFeatures([
      { id: 'PF99999', type: 'Pfam', start: 5, end: 10 },
    ]);
    expect(out[0].name).toBe('PF99999');
  });

  it('throws when given a non-array payload', () => {
    expect(() =>
      fromEnsemblProteinFeatures({ message: 'not found' } as unknown),
    ).toThrow(/expected an array/);
  });
});
