import { describe, expect, it } from 'vitest';
import {
  DOSAGE_L1_MEAN,
  distanceMatrix,
  dosagesFromCalls,
  dosagesFromGenotypeMatrix,
  upgma,
  upgmaFromCalls,
} from './upgma';
import { buildChildrenIndex, nodeHeights } from '../tree/index';
import { leafOrder } from '../tree/walk';
import { toNewick } from '../tree/newick';
import type { GenotypeMatrix } from '../types';

const sym = (n: number, entries: Array<[number, number, number]>): Float32Array => {
  const m = new Float32Array(n * n);
  for (const [i, j, d] of entries) {
    m[i * n + j] = d;
    m[j * n + i] = d;
  }
  return m;
};

describe('dosagesFromCalls', () => {
  it('lays dosages out variant-major with NaN for missing calls', () => {
    const d = dosagesFromCalls(
      [
        { sample: 'a', pos: 10, GT: [0, 1] },
        { sample: 'b', pos: 10, GT: [1, 1] },
        { sample: 'a', pos: 20, GT: [0, null] },
        { sample: 'b', pos: 20, GT: [null, null] },
        { sample: 'b', pos: 30, GT: null },
        { sample: 'zzz', pos: 10, GT: [1, 1] },
        { sample: 'a', pos: 999, GT: [1, 1] },
      ],
      ['a', 'b'],
      [10, 20, 30],
    );
    expect(Array.from(d)).toEqual([0.5, 1, 0, NaN, NaN, NaN]);
  });
});

describe('dosagesFromGenotypeMatrix', () => {
  const matrix: GenotypeMatrix = {
    variants: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
    callsByGeneId: {
      a: ['0/0', '0|1', '1/2'],
      b: ['./.', '1/.', ''],
    },
  };

  it('decodes BrAPI cells into the same layout as dosagesFromCalls', () => {
    const { dosages, samples, numVariants } = dosagesFromGenotypeMatrix(matrix);
    expect(samples).toEqual(['a', 'b']);
    expect(numVariants).toBe(3);
    expect(Array.from(dosages)).toEqual([0, NaN, 0.5, 1, 1, NaN]);
  });

  it('honours an explicit sample list (unknown samples are all NaN) and custom separators', () => {
    const { dosages, samples } = dosagesFromGenotypeMatrix(matrix, ['b', 'nope']);
    expect(samples).toEqual(['b', 'nope']);
    expect(Array.from(dosages)).toEqual([NaN, NaN, 1, NaN, NaN, NaN]);
    const custom: GenotypeMatrix = {
      variants: [{ id: 'v' }],
      callsByGeneId: { a: ['0-1'], b: ['N-N'] },
      sepUnphased: '-',
      unknownString: 'N',
    };
    expect(Array.from(dosagesFromGenotypeMatrix(custom).dosages)).toEqual([0.5, NaN]);
  });
});

describe('distanceMatrix', () => {
  it('averages |dosage differences| over shared called variants, 0 when none are shared', () => {
    // 2 variants × 3 samples, variant-major.
    const d = new Float32Array([0, 1, NaN, 0.5, 0.5, NaN]);
    const m = distanceMatrix(d, 3, 2);
    expect(m[0 * 3 + 1]).toBeCloseTo(0.5, 6);
    expect(m[1 * 3 + 0]).toBeCloseTo(0.5, 6);
    expect(m[0 * 3 + 2]).toBe(0);
    expect(m[0]).toBe(0);
  });
});

describe('upgma', () => {
  it('builds a flat tree with synthetic ids, preorder insertion and height-difference distances', () => {
    // a–b closest (0.2), then c joins at 0.6 avg → merge heights 0.1 and 0.3.
    const dist = sym(3, [
      [0, 1, 0.2],
      [0, 2, 0.6],
      [1, 2, 0.6],
    ]);
    const r = upgma(['1001', '7', '42'], dist);
    expect(r.method).toBe('upgma');
    expect(r.metric).toBe(DOSAGE_L1_MEAN);
    expect(r.leafOrder).toEqual(['1001', '7', '42']);
    expect(r.maxHeight).toBeCloseTo(0.3, 6);
    expect(r.tree.rootId).toBe('c1');
    // Root first, then the left subtree, then the right: child order survives Object.keys.
    expect(Object.keys(r.tree.nodes)).toEqual(['c1', 'c0', 'l0', 'l1', 'l2']);
    expect(buildChildrenIndex(r.tree).get('c1')).toEqual(['c0', 'l2']);
    expect(buildChildrenIndex(r.tree).get('c0')).toEqual(['l0', 'l1']);
    expect(r.tree.nodes['l0']).toMatchObject({ id: 'l0', parentId: 'c0', isLeaf: true, geneId: '1001' });
    expect(r.tree.nodes['l0']!.distance).toBeCloseTo(0.1, 6);
    expect(r.tree.nodes['l2']!.geneId).toBe('42');
    expect(r.tree.nodes['l2']!.distance).toBeCloseTo(0.3, 6);
    expect(r.tree.nodes['c0']!.distance).toBeCloseTo(0.2, 6);
    expect(Object.keys(r.heights).sort()).toEqual(['c0', 'c1', 'l0', 'l1', 'l2']);
    expect(r.heights['c1']).toBe(r.maxHeight);
    expect(r.heights['c0']).toBeCloseTo(0.1, 6);
    expect([r.heights['l0'], r.heights['l1'], r.heights['l2']]).toEqual([0, 0, 0]);
    expect(nodeHeights(r.tree).maxHeight).toBeCloseTo(r.maxHeight, 9); // float64 arithmetic on identical values
    expect(toNewick(r.tree)).toBe('((1001:0.100000,7:0.100000):0.200000,42:0.300000);');
    expect(leafOrder(r.tree).map((id) => r.tree.nodes[id]!.geneId)).toEqual(r.leafOrder);
  });

  it('breaks ties on the first (a, b) pair in scan order and keeps the merged cluster in the left slot', () => {
    // All distances equal: (0,1) merge first, then (c0, 2) [c0 sits in slot 0], then (c1, 3).
    const n = 4;
    const dist = new Float32Array(n * n).fill(1);
    for (let i = 0; i < n; i++) dist[i * n + i] = 0;
    const r = upgma(['a', 'b', 'c', 'd'], dist);
    expect(toNewick(r.tree)).toBe('(((a:0.500000,b:0.500000):0.000000,c:0.500000):0.000000,d:0.500000);');
    expect(r.leafOrder).toEqual(['a', 'b', 'c', 'd']);
  });

  it('prefixes ids, handles a single sample, and throws on none', () => {
    const r = upgma(['x', 'y'], sym(2, [[0, 1, 1]]), { idPrefix: 'u_' });
    expect(Object.keys(r.tree.nodes)).toEqual(['u_c0', 'u_l0', 'u_l1']);
    const one = upgma(['solo'], new Float32Array(1));
    expect(one.tree.rootId).toBe('l0');
    expect(one.tree.nodes['l0']).toMatchObject({ isLeaf: true, geneId: 'solo', parentId: null, distance: 0 });
    expect(one.leafOrder).toEqual(['solo']);
    expect(one.maxHeight).toBe(0);
    expect(toNewick(one.tree)).toBe('solo;');
    expect(() => upgma([], new Float32Array(0))).toThrow('upgma: no samples');
  });
});

describe('upgmaFromCalls', () => {
  it('chains dosages → distances → upgma', () => {
    const calls = [
      { sample: 'a', pos: 1, GT: [0, 0] },
      { sample: 'b', pos: 1, GT: [0, 0] },
      { sample: 'c', pos: 1, GT: [1, 1] },
      { sample: 'a', pos: 2, GT: [0, 1] },
      { sample: 'b', pos: 2, GT: [0, 1] },
      { sample: 'c', pos: 2, GT: [1, 1] },
    ];
    const r = upgmaFromCalls(calls, ['a', 'b', 'c'], [1, 2]);
    expect(r.leafOrder).toEqual(['a', 'b', 'c']);
    expect(r.heights['c0']).toBe(0);
    expect(r.maxHeight).toBeCloseTo(0.375, 6);
    const direct = upgma(['a', 'b', 'c'], distanceMatrix(dosagesFromCalls(calls, ['a', 'b', 'c'], [1, 2]), 3, 2));
    expect(toNewick(r.tree)).toBe(toNewick(direct.tree));
  });
});
