/**
 * Parity: `cluster/upgma` against the verbatim gramene-g2p copy in
 * `test/legacy/g2p-cluster.ts` — identical Newick output, leaf order and
 * tree height on seeded random matrices, including numeric-string sample
 * names (the reason the flat tree uses synthetic `l<i>` / `c<k>` ids).
 */
import { describe, expect, it } from 'vitest';
import {
  distanceMatrix as legacyDistanceMatrix,
  dosagesFromCalls as legacyDosagesFromCalls,
  leafOrder as legacyLeafOrder,
  toNewick as legacyToNewick,
  upgma as legacyUpgma,
  type TreeNode as LegacyTreeNode,
} from '../legacy/g2p-cluster';
import {
  distanceMatrix,
  dosagesFromCalls,
  dosagesFromGenotypeMatrix,
  upgma,
  upgmaFromCalls,
} from '../../src/cluster/upgma';
import { toNewick } from '../../src/tree/newick';
import { leafOrder } from '../../src/tree/walk';
import { nodeHeights } from '../../src/tree/index';
import { mulberry32, randInt, randomDistanceMatrix } from '../tree/helpers';
import type { GenotypeMatrix } from '../../src/types';

/** gramene-g2p `brapi/genotyping.ts:555-558` (`maxHeight`). */
function legacyMaxHeight(node: LegacyTreeNode): number {
  if (node.kind === 'leaf') return 0;
  return Math.max(node.height, legacyMaxHeight(node.left), legacyMaxHeight(node.right));
}

const numericNames = (n: number, rand: () => number): string[] => {
  // Numeric strings (canonical integers enumerate first under Object.keys)
  // mixed with plain names, shuffled so numeric ones land anywhere.
  const names: string[] = [];
  for (let i = 0; i < n; i++) names.push(i % 3 === 0 ? `S${i}` : String(1000 + randInt(rand, 5000)));
  // Dedupe while keeping length.
  const seen = new Set<string>();
  return names.map((s) => {
    let t = s;
    while (seen.has(t)) t = `${t}x`;
    seen.add(t);
    return t;
  });
};

describe('upgma(samples, dist) === legacy upgma (Newick, leaf order, height)', () => {
  const cases: Array<{ seed: number; n: number; names: (rand: () => number) => string[] }> = [
    { seed: 1, n: 2, names: () => ['b', 'a'] },
    { seed: 2, n: 3, names: () => ['1001', '7', '42'] },
    { seed: 3, n: 5, names: () => ['42', '7', '1001', 'x', '3'] },
    { seed: 4, n: 8, names: (r) => numericNames(8, r) },
    { seed: 5, n: 13, names: (r) => numericNames(13, r) },
    { seed: 6, n: 25, names: (r) => numericNames(25, r) },
    { seed: 7, n: 40, names: (r) => numericNames(40, r) },
  ];

  for (const { seed, n, names } of cases) {
    it(`seed ${seed}, ${n} samples`, () => {
      const rand = mulberry32(seed);
      const samples = names(rand);
      const dist = randomDistanceMatrix(rand, n);
      const legacyRoot = legacyUpgma([...samples], dist);
      const ours = upgma(samples, dist);
      expect(toNewick(ours.tree)).toBe(legacyToNewick(legacyRoot));
      expect(ours.leafOrder).toEqual(legacyLeafOrder(legacyRoot));
      expect(leafOrder(ours.tree).map((id) => ours.tree.nodes[id]!.geneId)).toEqual(legacyLeafOrder(legacyRoot));
      expect(Math.abs(ours.maxHeight - legacyMaxHeight(legacyRoot))).toBeLessThan(1e-9);
      expect(Math.abs(nodeHeights(ours.tree).maxHeight - ours.maxHeight)).toBeLessThan(1e-9);
      // No sample name is ever a node id.
      for (const s of samples) expect(ours.tree.nodes[s]).toBeUndefined();
    });
  }

  it('ties: an all-equal matrix with numeric names merges in exactly the legacy order', () => {
    const samples = ['9', '1001', '3', 'a', '42'];
    const n = samples.length;
    const dist = new Float32Array(n * n).fill(0.25);
    for (let i = 0; i < n; i++) dist[i * n + i] = 0;
    const legacyRoot = legacyUpgma([...samples], dist);
    const ours = upgma(samples, dist);
    expect(toNewick(ours.tree)).toBe(legacyToNewick(legacyRoot));
    expect(ours.leafOrder).toEqual(['9', '1001', '3', 'a', '42']);
  });
});

describe('distanceMatrix / dosagesFromCalls === legacy', () => {
  it('bit-identical on a seeded random long-form call set', () => {
    const rand = mulberry32(11);
    const samples = numericNames(9, rand);
    const positions = [100, 250, 300, 777, 1000, 1200];
    const calls: Array<{ sample: string; pos: number; GT?: Array<number | null> | null }> = [];
    for (const s of samples) {
      for (const p of positions) {
        const roll = rand();
        const gt: Array<number | null> | null =
          roll < 0.1 ? null : roll < 0.2 ? [null, null] : roll < 0.3 ? [randInt(rand, 2), null] : [randInt(rand, 2), randInt(rand, 2)];
        calls.push({ sample: s, pos: p, GT: gt });
      }
    }
    const a = dosagesFromCalls(calls, samples, positions);
    const b = legacyDosagesFromCalls(calls, [...samples], [...positions]);
    expect(Array.from(a)).toEqual(Array.from(b));
    const da = distanceMatrix(a, samples.length, positions.length);
    const db = legacyDistanceMatrix(b, samples.length, positions.length);
    expect(Array.from(da)).toEqual(Array.from(db));
    const ours = upgmaFromCalls(calls, samples, positions);
    const legacyRoot = legacyUpgma([...samples], db);
    expect(toNewick(ours.tree)).toBe(legacyToNewick(legacyRoot));
  });
});

describe('dosagesFromGenotypeMatrix === dosagesFromCalls on the same calls expressed both ways', () => {
  it('matches on a seeded random matrix including partially missing and phased cells', () => {
    const rand = mulberry32(23);
    const samples = numericNames(12, rand);
    const positions = [5, 17, 42, 99, 123, 5000, 5001];
    const calls: Array<{ sample: string; pos: number; GT?: Array<number | null> | null }> = [];
    const callsByGeneId: Record<string, string[]> = {};
    for (const s of samples) {
      callsByGeneId[s] = [];
      for (const p of positions) {
        const roll = rand();
        let gt: Array<number | null> | null;
        if (roll < 0.1) gt = null;
        else if (roll < 0.2) gt = [null, null];
        else if (roll < 0.3) gt = [randInt(rand, 3), null];
        else gt = [randInt(rand, 3), randInt(rand, 3)];
        calls.push({ sample: s, pos: p, GT: gt });
        const sep = rand() < 0.5 ? '|' : '/';
        callsByGeneId[s]!.push(gt === null ? '' : gt.map((x) => (x === null ? '.' : String(x))).join(sep));
      }
    }
    const matrix: GenotypeMatrix = {
      variants: positions.map((p) => ({ id: `1:${p}`, reference: '1', position: p })),
      callsByGeneId,
    };
    const fromCalls = dosagesFromCalls(calls, samples, positions);
    const fromMatrix = dosagesFromGenotypeMatrix(matrix, samples);
    expect(fromMatrix.samples).toEqual(samples);
    expect(fromMatrix.numVariants).toBe(positions.length);
    expect(Array.from(fromMatrix.dosages)).toEqual(Array.from(fromCalls));
    // Default sample list = Object.keys(callsByGeneId): insertion order for
    // non-numeric names, but integer-like names enumerate first in numeric order.
    const mixed: GenotypeMatrix = { variants: [{ id: '1:5' }], callsByGeneId: { S0: ['0/1'], '4321': ['0/0'], '77': ['1/1'], S3: ['0/0'] } };
    expect(dosagesFromGenotypeMatrix(mixed).samples).toEqual(['77', '4321', 'S0', 'S3']);
    expect(dosagesFromGenotypeMatrix(mixed, ['S0', '4321', '77', 'S3']).samples).toEqual(['S0', '4321', '77', 'S3']);
    // And the trees agree end to end.
    const viaMatrix = upgma(samples, distanceMatrix(fromMatrix.dosages, samples.length, positions.length));
    const viaCalls = upgmaFromCalls(calls, samples, positions);
    expect(toNewick(viaMatrix.tree)).toBe(toNewick(viaCalls.tree));
  });
});
