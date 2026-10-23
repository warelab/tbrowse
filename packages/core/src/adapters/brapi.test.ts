import { describe, expect, it } from 'vitest';
import {
  fromBrAPIAlleleMatrix,
  fromBrAPIGermplasm,
  fromBrAPITree,
  fromBrAPIVariants,
  mergeVariantSites,
} from './brapi';
import { leafOrder } from '../tree/walk';
import type { GenotypeMatrix } from '../types';

const matrixResponse = {
  metadata: { pagination: { currentPage: 0, totalPages: 1 } },
  result: {
    callSetDbIds: ['1001', '7', '42'],
    variantDbIds: ['1:100', '1:200', 'rs9'],
    variantSetDbIds: ['vs1'],
    sepPhased: '|',
    sepUnphased: '/',
    unknownString: '.',
    dataMatrices: [
      { dataMatrixName: 'Dosage', dataMatrix: [[0, 1, 2], [0, 0, 0], [2, 2, 1]] },
      {
        dataMatrixName: 'Genotype',
        dataMatrixAbbreviation: 'GT',
        dataMatrix: [
          ['0/0', '0/1', '1/1'],
          ['0/0', './.', '0/0'],
          ['1/1', '1/1', null],
        ],
      },
    ],
    tree: {
      method: 'upgma',
      metric: 'dosage_l1_mean',
      newick: '((1001:0.1,7:0.1):0.2,42:0.3);',
      leafOrder: ['42', '7', '1001'],
      maxBranchHeight: 0.3,
      source: 'region',
    },
  },
};

describe('fromBrAPIAlleleMatrix', () => {
  const r = fromBrAPIAlleleMatrix(matrixResponse);

  it('transposes the variant-major Genotype matrix into per-sample rows', () => {
    expect(r.sampleIds).toEqual(['1001', '7', '42']);
    expect(r.matrix.callsByGeneId).toEqual({
      '1001': ['0/0', '0/0', '1/1'],
      '7': ['0/1', './.', '1/1'],
      '42': ['1/1', '0/0', ''],
    });
    expect(r.matrix.sepPhased).toBe('|');
    expect(r.matrix.sepUnphased).toBe('/');
    expect(r.matrix.unknownString).toBe('.');
  });

  it('parses <chrom>:<pos> variant ids and leaves other ids opaque', () => {
    expect(r.matrix.variants).toEqual([
      { id: '1:100', reference: '1', position: 100 },
      { id: '1:200', reference: '1', position: 200 },
      { id: 'rs9' },
    ]);
  });

  it('surfaces the tree block, the first variantSetDbId and a synthesised region label', () => {
    expect(r.newick).toBe('((1001:0.1,7:0.1):0.2,42:0.3);');
    expect(r.treeMethod).toBe('upgma');
    expect(r.treeMetric).toBe('dosage_l1_mean');
    expect(r.leafOrder).toEqual(['42', '7', '1001']);
    expect(r.variantSetDbId).toBe('vs1');
    // First and last variants do not share a reference → no synthesised label.
    expect(r.matrix).not.toHaveProperty('regionLabel');
    const same = fromBrAPIAlleleMatrix({
      result: {
        callSetDbIds: ['a'],
        variantDbIds: ['2:1000', '2:2500'],
        dataMatrices: [{ dataMatrix: [['0/0'], ['0/1']] }],
      },
    });
    expect(same.matrix.regionLabel).toBe(`2:${(1000).toLocaleString()}–${(2500).toLocaleString()}`);
    expect(fromBrAPIAlleleMatrix(matrixResponse, { regionLabel: 'custom' }).matrix.regionLabel).toBe('custom');
    expect(r).not.toHaveProperty('pagination');
    // Optional keys are absent, never undefined.
    expect(same).not.toHaveProperty('newick');
    expect(same).not.toHaveProperty('variantSetDbId');
    expect(same.matrix).not.toHaveProperty('sepPhased');
  });

  it('throws on malformed responses', () => {
    expect(() => fromBrAPIAlleleMatrix(null)).toThrow('BrAPI: response has no `result` object');
    expect(() => fromBrAPIAlleleMatrix({ result: { variantDbIds: [] } })).toThrow('`callSetDbIds`');
    expect(() =>
      fromBrAPIAlleleMatrix({ result: { callSetDbIds: ['a'], variantDbIds: ['v'], dataMatrices: [] } }),
    ).toThrow('no `dataMatrices`');
    expect(() =>
      fromBrAPIAlleleMatrix({
        result: { callSetDbIds: ['a'], variantDbIds: ['v', 'w'], dataMatrices: [{ dataMatrix: [['0/0']] }] },
      }),
    ).toThrow("row count (1) doesn't match variantDbIds (2)");
    expect(() =>
      fromBrAPIAlleleMatrix({
        result: { callSetDbIds: ['a', 'b'], variantDbIds: ['v'], dataMatrices: [{ dataMatrix: [['0/0']] }] },
      }),
    ).toThrow('dataMatrix[0] has 1 cells but expected 2');
  });
});

describe('fromBrAPIGermplasm', () => {
  it('keys each record by germplasmDbId AND germplasmName and keeps non-standard columns in extras', () => {
    const out = fromBrAPIGermplasm({
      result: {
        data: [
          {
            germplasmDbId: 'G1',
            germplasmName: 'Alpha',
            species: 'Sorghum bicolor',
            synonyms: ['A', 7, 'B'],
            instituteCode: 'ICRISAT',
            extras: { population: 'SC' },
          },
          { germplasmName: 'Beta' },
          'junk',
        ],
      },
    });
    expect(Object.keys(out).sort()).toEqual(['Alpha', 'Beta', 'G1']);
    expect(out.G1).toBe(out.Alpha);
    expect(out.G1).toEqual({
      germplasmDbId: 'G1',
      germplasmName: 'Alpha',
      species: 'Sorghum bicolor',
      synonyms: ['A', 'B'],
      extras: { population: 'SC', instituteCode: 'ICRISAT' },
    });
    expect(out.Beta).toEqual({ germplasmName: 'Beta' });
  });

  it('accepts a bare array and returns {} for anything else', () => {
    expect(fromBrAPIGermplasm([{ germplasmDbId: 'X' }])).toEqual({ X: { germplasmDbId: 'X' } });
    expect(fromBrAPIGermplasm(null)).toEqual({});
    expect(fromBrAPIGermplasm({ result: { data: 'nope' } })).toEqual({});
  });
});

describe('fromBrAPIAlleleMatrix (standard /allelematrix page)', () => {
  it('surfaces the per-dimension pagination array and ignores junk entries', () => {
    const r = fromBrAPIAlleleMatrix({
      metadata: { pagination: { currentPage: 0, totalPages: 1 } },
      result: {
        callSetDbIds: ['cs1', 'cs2'],
        variantDbIds: ['variant01', 'variant02'],
        variantSetDbIds: ['variantset1'],
        sepPhased: '|',
        sepUnphased: '/',
        unknownString: '.',
        pagination: [
          { dimension: 'VARIANTS', page: 0, pageSize: 100, totalCount: 20, totalPages: 1 },
          { dimension: 'CALLSETS', page: 0, pageSize: 100, totalCount: 13, totalPages: 1 },
          null,
          'junk',
          { dimension: 7, page: 'x' },
        ],
        dataMatrices: [
          { dataMatrixName: 'Genotype', dataMatrixAbbreviation: 'GT', dataType: 'string', dataMatrix: [['0/0', '0|1'], ['1/1', './.']] },
          { dataMatrixName: 'Read Depth', dataMatrixAbbreviation: 'DP', dataType: 'integer', dataMatrix: [[10, 12], [9, 0]] },
        ],
      },
    });
    expect(r.sampleIds).toEqual(['cs1', 'cs2']);
    // Opaque ids: no chrom:pos to parse.
    expect(r.matrix.variants).toEqual([{ id: 'variant01' }, { id: 'variant02' }]);
    expect(r.matrix.callsByGeneId).toEqual({ cs1: ['0/0', '1/1'], cs2: ['0|1', './.'] });
    expect(r.variantSetDbId).toBe('variantset1');
    expect(r.pagination).toEqual([
      { dimension: 'VARIANTS', page: 0, pageSize: 100, totalCount: 20, totalPages: 1 },
      { dimension: 'CALLSETS', page: 0, pageSize: 100, totalCount: 13, totalPages: 1 },
      { dimension: '', page: 0, pageSize: 0, totalCount: 0, totalPages: 0 },
    ]);
    expect(r).not.toHaveProperty('newick');
  });
});

describe('fromBrAPIVariants (standard BrAPI v2 variant objects)', () => {
  const standard = {
    metadata: { pagination: { currentPage: 0, pageSize: 1000, totalCount: 3, totalPages: 1 } },
    result: {
      data: [
        { variantDbId: 'variant01', variantNames: ['rs1'], referenceName: '1', start: 100, end: 100, referenceBases: 'A', alternateBases: ['T'], variantSetDbId: 'variantset1' },
        { variantDbId: 'variant02', referenceName: '1', start: 200, referenceBases: 'C', alternateBases: ['G', 'GA', 7] },
        // Duplicate id → first wins.
        { variantDbId: 'variant01', referenceName: '9', start: 999 },
        // No position, no bases, empty referenceName → id only (reference from opts).
        { variantDbId: 'variant03', referenceName: '', start: 'n/a', referenceBases: '', alternateBases: 'x' },
        // Empty id → falls through to the long-form branch, which skips it (no pos).
        { variantDbId: '', referenceName: '1', start: 5 },
      ],
    },
  };

  it('keeps variantDbId as the id and maps referenceName/start/referenceBases/alternateBases', () => {
    expect(fromBrAPIVariants(standard)).toEqual([
      { id: 'variant01', reference: '1', position: 100, ref: 'A', alt: ['T'] },
      { id: 'variant02', reference: '1', position: 200, ref: 'C', alt: ['G', 'GA'] },
      { id: 'variant03' },
    ]);
    expect(fromBrAPIVariants(standard, { reference: 'chrX' })[2]).toEqual({ id: 'variant03', reference: 'chrX' });
  });

  it('mixes standard objects with g2p long-form rows', () => {
    expect(
      fromBrAPIVariants([
        { variantDbId: 'variant01', start: 100, referenceBases: 'A', alternateBases: ['T'] },
        { sample: 's1', pos: 300, ref: 'G', alleles: ['G', 'C'], GT: [0, 1] },
      ], { reference: '1' }),
    ).toEqual([
      { id: 'variant01', reference: '1', position: 100, ref: 'A', alt: ['T'] },
      { id: '1:300', reference: '1', position: 300, ref: 'G', alt: ['C'] },
    ]);
  });

  it('joins standard sites to opaque matrix ids by variantDbId', () => {
    const matrix: GenotypeMatrix = {
      variants: [{ id: 'variant01' }, { id: 'variant02' }],
      callsByGeneId: { cs1: ['0/0', '0/1'] },
    };
    const merged = mergeVariantSites(matrix, fromBrAPIVariants([
      { variantDbId: 'variant02', referenceBases: 'C', alternateBases: ['G'] },
      { variantDbId: 'variant01', referenceName: '1', start: 100, referenceBases: 'A', alternateBases: ['T'] },
    ]));
    expect(merged.variants).toEqual([{ id: 'variant01', ref: 'A', alt: ['T'] }, { id: 'variant02', ref: 'C', alt: ['G'] }]);
  });
});

describe('fromBrAPIVariants', () => {
  const rows = {
    result: {
      data: [
        { sample: 's1', pos: 200, ref: 'A', alleles: ['A', 'T'], GT: [0, 1] },
        { sample: 's2', pos: 200, ref: 'A', alleles: ['A', 'T'], GT: [1, 1] },
        { sample: 's1', pos: 100, ref: 'G', alleles: ['G', 'C', 'GA'], GT: [0, 0] },
        { sample: 's1', alleles: ['N'] },
        { sample: 's1', pos: 300, alleles: 'bad' },
      ],
    },
  };

  it('yields one site per pos (first wins) with id reference:pos and alt = alleles.slice(1)', () => {
    expect(fromBrAPIVariants(rows, { reference: '1' })).toEqual([
      { id: '1:200', reference: '1', position: 200, ref: 'A', alt: ['T'] },
      { id: '1:100', reference: '1', position: 100, ref: 'G', alt: ['C', 'GA'] },
      { id: '1:300', reference: '1', position: 300, alt: [] },
    ]);
  });

  it('synthesises ":pos" ids without a reference, accepts a bare array and ignores junk', () => {
    const sites = fromBrAPIVariants(rows.result.data);
    expect(sites.map((s) => s.id)).toEqual([':200', ':100', ':300']);
    expect(sites[0]).not.toHaveProperty('reference');
    expect(fromBrAPIVariants(null)).toEqual([]);
    expect(fromBrAPIVariants({ result: {} })).toEqual([]);
  });
});

describe('mergeVariantSites', () => {
  const matrix: GenotypeMatrix = {
    variants: [
      { id: '1:100', reference: '1', position: 100 },
      { id: '1:200', reference: '1', position: 200, ref: 'C', alt: ['G'] },
      { id: 'rs9' },
      { id: 'rs10' },
    ],
    callsByGeneId: { a: ['0/0', '0/1', '1/1', '0/0'] },
  };

  it('joins by position first, then by id, and returns a new matrix', () => {
    const merged = mergeVariantSites(matrix, [
      { id: 'other:100', position: 100, ref: 'A', alt: ['T'] },
      { id: '1:200', position: 200, alt: ['GA'], alleleFrequency: 0.25 },
      { id: 'rs9', ref: 'T', alt: ['A'] },
      // Same id as a position-less matrix column: joins by id even though the site has a position.
      { id: 'rs10', position: 999, ref: 'X' },
    ]);
    expect(merged).not.toBe(matrix);
    expect(merged.variants).not.toBe(matrix.variants);
    expect(merged.callsByGeneId).toBe(matrix.callsByGeneId);
    expect(merged.variants).toEqual([
      { id: '1:100', reference: '1', position: 100, ref: 'A', alt: ['T'] },
      { id: '1:200', reference: '1', position: 200, ref: 'C', alt: ['GA'], alleleFrequency: 0.25 },
      { id: 'rs9', ref: 'T', alt: ['A'] },
      { id: 'rs10', ref: 'X' },
    ]);
    // The input is untouched.
    expect(matrix.variants[0]).toEqual({ id: '1:100', reference: '1', position: 100 });
  });

  it('returns the same object when nothing matches', () => {
    expect(mergeVariantSites(matrix, [{ id: 'x', position: 5 }])).toBe(matrix);
    expect(mergeVariantSites(matrix, [])).toBe(matrix);
  });
});

describe('fromBrAPITree', () => {
  it('returns null without a newick', () => {
    expect(fromBrAPITree({})).toBeNull();
    expect(fromBrAPITree({ newick: '  ', leafOrder: ['a'] })).toBeNull();
  });

  it('parses with synthetic ids (numeric sample names stay on geneId) and swaps to reproduce the server order', () => {
    const r = fromBrAPIAlleleMatrix(matrixResponse);
    const parsed = fromBrAPITree(r)!;
    expect(parsed).not.toBeNull();
    const { tree, swappedNodeIds, unmatched } = parsed;
    expect(unmatched).toEqual([]);
    // No label is an id; leaves carry the sample name as geneId.
    expect(Object.keys(tree.nodes).every((id) => /^n\d+$/.test(id))).toBe(true);
    const geneIds = Object.values(tree.nodes).filter((n) => n.isLeaf).map((n) => n.geneId).sort();
    expect(geneIds).toEqual(['1001', '42', '7']);
    // callsByGeneId joins on the leaf geneId.
    for (const n of Object.values(tree.nodes)) {
      if (n.isLeaf) expect(r.matrix.callsByGeneId[n.geneId!]).toBeDefined();
    }
    // Unswapped order is the Newick's order; with the swaps it is the server's leafOrder.
    const names = (ids: string[]) => ids.map((id) => tree.nodes[id]!.geneId);
    expect(names(leafOrder(tree))).toEqual(['1001', '7', '42']);
    expect(swappedNodeIds.length).toBeGreaterThan(0);
    expect(names(leafOrder(tree, { swappedNodeIds: new Set(swappedNodeIds) }))).toEqual(r.leafOrder);
  });

  it('with no leafOrder returns no swaps; unknown labels are reported as unmatched', () => {
    const plain = fromBrAPITree({ newick: '(a,b);' })!;
    expect(plain.swappedNodeIds).toEqual([]);
    expect(plain.unmatched).toEqual([]);
    const partial = fromBrAPITree({ newick: '(a,b);', leafOrder: ['b', 'zzz', 'a'] })!;
    expect(partial.unmatched).toEqual(['zzz']);
    expect(partial.swappedNodeIds).toEqual([partial.tree.rootId]);
  });

  it('forwards parse options (idPrefix) but always forces labelsAsIds: false', () => {
    const r = fromBrAPITree({ newick: '(a,b);' }, { idPrefix: 'bp', labelsAsIds: true })!;
    expect(Object.keys(r.tree.nodes)).toEqual(['bpn0', 'bpn1', 'bpn2']);
  });
});

describe('fromBrAPITree forces leafGeneId', () => {
  it('keeps the sample name on geneId even when the caller passes leafGeneId: false', () => {
    const r = fromBrAPITree({ newick: '((s1:1,s2:1):0.5,s3:1.5);', leafOrder: ['s3', 's1', 's2'] }, { leafGeneId: false } as never);
    expect(r).not.toBeNull();
    const leaves = Object.values(r!.tree.nodes).filter((n) => n.isLeaf).map((n) => n.geneId).sort();
    expect(leaves).toEqual(['s1', 's2', 's3']);
    expect(r!.unmatched).toEqual([]);
  });
});
