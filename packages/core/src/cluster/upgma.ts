/**
 * UPGMA hierarchical clustering of genotype dosages.
 *
 * Origin: gramene-g2p `apps/api/src/cluster.ts` (the live server copy; a
 * verbatim copy sits at `test/legacy/g2p-cluster.ts` as the parity oracle).
 * `distanceMatrix`, `upgma`'s merge loop and `dosagesFromCalls` keep that
 * file's arithmetic, merge order and tie-breaking exactly; the only
 * addition is the conversion of the nested binary result into a flat
 * `Tree` (see `upgma`) and `dosagesFromGenotypeMatrix`, which builds the
 * same dosage layout from a `GenotypeMatrix`.
 *
 * Distance metric: mean absolute difference of allele dosages across the
 * supplied variants. Dosage = (# non-zero alleles) / (# called alleles)
 * ∈ {0, 0.5, 1} for diploids. Pairs skip variants where either side is
 * missing so a sample with sparse coverage doesn't pull everyone toward
 * zero distance.
 */
import type { GenotypeMatrix, NodeId, Tree, TreeNode } from '../types';
import {
  DEFAULT_SEP_PHASED,
  DEFAULT_SEP_UNPHASED,
  DEFAULT_UNKNOWN,
  decodeCall,
} from '../genotype/encoding';

/** A long-form genotype call: per-allele indices (0 = REF), `null` for a
 *  missing allele, or the whole call `null`/absent. */
export type GtCall = ReadonlyArray<number | null> | null | undefined;

/** Name of the distance metric `distanceMatrix` implements, as the BrAPI tree block reports it. */
export const DOSAGE_L1_MEAN = 'dosage_l1_mean';

/**
 * Build a per-(variant, sample) dosage matrix from long-form region calls.
 * Layout: row-major `[variantIdx * numSamples + sampleIdx]`; a cell with no
 * call, an all-missing call, or a (sample, pos) outside the supplied lists
 * stays `NaN`. Dosage = non-REF alleles / called alleles.
 * Origin: gramene-g2p `apps/api/src/cluster.ts:118-146` (`dosagesFromCalls`), verbatim.
 */
export function dosagesFromCalls(
  calls: ReadonlyArray<{ sample: string; pos: number; GT?: GtCall }>,
  samples: readonly string[],
  variantPositions: readonly number[],
): Float32Array {
  const sIdx = new Map<string, number>();
  samples.forEach((s, i) => sIdx.set(s, i));
  const vIdx = new Map<number, number>();
  variantPositions.forEach((p, i) => vIdx.set(p, i));

  const n = variantPositions.length * samples.length;
  const arr = new Float32Array(n);
  arr.fill(NaN);

  for (const c of calls) {
    const gt = c.GT;
    if (!gt || gt.length === 0) continue;
    let alt = 0,
      tot = 0;
    for (const a of gt) {
      if (a === null) continue;
      tot++;
      if (a !== 0) alt++;
    }
    if (tot === 0) continue;
    const v = vIdx.get(c.pos);
    const s = sIdx.get(c.sample);
    if (v === undefined || s === undefined) continue;
    arr[v * samples.length + s] = alt / tot;
  }
  return arr;
}

/**
 * The same dosage layout as `dosagesFromCalls`, built from a
 * `GenotypeMatrix` (BrAPI cell strings). Each cell is decoded with
 * `decodeCall` using the matrix's separators; dosage = `altDosage` /
 * number of called (non-missing) alleles, so `"0/1"` → 0.5 exactly as the
 * long-form `[0, 1]` does, and an empty or fully missing call → `NaN`.
 * `samples` defaults to `Object.keys(matrix.callsByGeneId)` — note that
 * integer-like sample names enumerate FIRST, in ascending numeric order, so
 * pass `samples` (e.g. the BrAPI `callSetDbIds`) whenever the server's order
 * matters. A sample with no row is all `NaN`. `numVariants` is
 * `matrix.variants.length`.
 */
export function dosagesFromGenotypeMatrix(
  matrix: GenotypeMatrix,
  samples?: readonly string[],
): { dosages: Float32Array; samples: string[]; numVariants: number } {
  const names = samples ? [...samples] : Object.keys(matrix.callsByGeneId);
  const numVariants = matrix.variants.length;
  const numSamples = names.length;
  const dosages = new Float32Array(numVariants * numSamples);
  dosages.fill(NaN);
  const sepPhased = matrix.sepPhased ?? DEFAULT_SEP_PHASED;
  const sepUnphased = matrix.sepUnphased ?? DEFAULT_SEP_UNPHASED;
  const unknown = matrix.unknownString ?? DEFAULT_UNKNOWN;
  for (let s = 0; s < numSamples; s++) {
    const row = matrix.callsByGeneId[names[s]!];
    if (!row) continue;
    for (let v = 0; v < numVariants; v++) {
      const call = decodeCall(row[v], sepPhased, sepUnphased, unknown);
      let called = 0;
      for (const a of call.alleles) if (a >= 0) called++;
      if (called === 0) continue;
      dosages[v * numSamples + s] = call.altDosage / called;
    }
  }
  return { dosages, samples: names, numVariants };
}

/**
 * Pairwise mean-absolute-dosage-difference matrix (row-major `n×n`, zero
 * diagonal, symmetric). Variants where either sample is `NaN` are skipped;
 * a pair with no shared called variant gets distance 0.
 * Origin: gramene-g2p `apps/api/src/cluster.ts:19-41` (`distanceMatrix`), verbatim.
 */
export function distanceMatrix(
  dosages: Float32Array,
  numSamples: number,
  numVariants: number,
): Float32Array {
  const m = new Float32Array(numSamples * numSamples);
  for (let i = 0; i < numSamples; i++) {
    for (let j = i + 1; j < numSamples; j++) {
      let sum = 0,
        count = 0;
      for (let v = 0; v < numVariants; v++) {
        const di = dosages[v * numSamples + i]!;
        const dj = dosages[v * numSamples + j]!;
        if (Number.isNaN(di) || Number.isNaN(dj)) continue;
        sum += Math.abs(di - dj);
        count++;
      }
      const d = count === 0 ? 0 : sum / count;
      m[i * numSamples + j] = d;
      m[j * numSamples + i] = d;
    }
  }
  return m;
}

/** Result of `upgma`: the flat tree plus the ultrametric heights it was built from. */
export interface UpgmaResult {
  /** Leaves `l<i>` (geneId = `samples[i]`), internal nodes `c<k>` in merge order, `distance = parent.height − child.height`. */
  tree: Tree;
  /** UPGMA height of every node, by node id (leaves 0). */
  heights: Record<NodeId, number>;
  /** Sample names in tree (left-to-right) order. */
  leafOrder: string[];
  /** Height of the tallest node (the root). */
  maxHeight: number;
  method: 'upgma';
  metric: typeof DOSAGE_L1_MEAN;
}

/** The nested binary cluster the merge loop builds, converted to a `Tree` afterwards. */
type Cluster =
  | { kind: 'leaf'; index: number; height: 0; size: 1 }
  | { kind: 'internal'; left: Cluster; right: Cluster; height: number; size: number; order: number };

/**
 * UPGMA (average-linkage) clustering of `samples` from a row-major `n×n`
 * distance matrix. Each round merges the closest pair — the first pair in
 * (a, b) scan order on ties, with the merged cluster taking the left
 * member's slot — at height `d/2`, the exact loop of gramene-g2p
 * `apps/api/src/cluster.ts:43-83`.
 *
 * The result is converted to a flat `Tree` with SYNTHETIC ids: leaf
 * `${idPrefix}l<i>` (i = index in `samples`, geneId = the sample name) and
 * internal `${idPrefix}c<k>` (k = merge order). Nodes are inserted in
 * pre-order (root first, left subtree before right) so that
 * `buildChildrenIndex` yields `[left, right]` — and because no id is a
 * numeric string, sample names such as `"1001"` can never reorder children
 * under `Object.keys`. `toNewick(result.tree)` therefore reproduces g2p's
 * serialisation byte for byte. Throws on zero samples; one sample yields a
 * single leaf root.
 */
export function upgma(
  samples: readonly string[],
  dist: Float32Array,
  opts: { idPrefix?: string } = {},
): UpgmaResult {
  const n = samples.length;
  if (n === 0) throw new Error('upgma: no samples');
  const prefix = opts.idPrefix ?? '';
  let root: Cluster;
  if (n === 1) {
    root = { kind: 'leaf', index: 0, height: 0, size: 1 };
  } else {
    const clusters: Cluster[] = samples.map((_, i) => ({ kind: 'leaf', index: i, height: 0, size: 1 }));
    const m: number[][] = [];
    for (let i = 0; i < n; i++) {
      m[i] = new Array<number>(n);
      for (let j = 0; j < n; j++) m[i]![j] = dist[i * n + j]!;
    }
    let active = clusters.length;
    const aliveIdx: number[] = clusters.map((_, i) => i);
    let merges = 0;

    while (active > 1) {
      let minA = 0,
        minB = 1,
        minD = Infinity;
      for (let a = 0; a < active; a++) {
        for (let b = a + 1; b < active; b++) {
          const d = m[aliveIdx[a]!]![aliveIdx[b]!]!;
          if (d < minD) {
            minD = d;
            minA = a;
            minB = b;
          }
        }
      }
      const i = aliveIdx[minA]!;
      const j = aliveIdx[minB]!;
      const ci = clusters[i]!;
      const cj = clusters[j]!;
      const merged: Cluster = {
        kind: 'internal',
        left: ci,
        right: cj,
        height: minD / 2,
        size: ci.size + cj.size,
        order: merges++,
      };
      clusters[i] = merged;
      for (let k = 0; k < active; k++) {
        if (k === minA || k === minB) continue;
        const ki = aliveIdx[k]!;
        const dNew = (ci.size * m[i]![ki]! + cj.size * m[j]![ki]!) / (ci.size + cj.size);
        m[i]![ki] = dNew;
        m[ki]![i] = dNew;
      }
      aliveIdx.splice(minB, 1);
      active--;
    }
    root = clusters[aliveIdx[0]!]!;
  }

  // Flatten in pre-order so insertion order == child order (left, right).
  const nodes: Record<NodeId, TreeNode> = {};
  const heights: Record<NodeId, number> = {};
  const leafOrder: string[] = [];
  let maxHeight = 0;
  const visit = (c: Cluster, parentId: NodeId | null, parentHeight: number): NodeId => {
    const distance = parentId === null ? 0 : parentHeight - c.height;
    if (c.kind === 'leaf') {
      const id = `${prefix}l${c.index}`;
      nodes[id] = { id, parentId, distance, isLeaf: true, geneId: samples[c.index]! };
      heights[id] = 0;
      leafOrder.push(samples[c.index]!);
      return id;
    }
    const id = `${prefix}c${c.order}`;
    nodes[id] = { id, parentId, distance, isLeaf: false };
    heights[id] = c.height;
    if (c.height > maxHeight) maxHeight = c.height;
    visit(c.left, id, c.height);
    visit(c.right, id, c.height);
    return id;
  };
  const rootId = visit(root, null, root.height);
  return {
    tree: { rootId, nodes },
    heights,
    leafOrder,
    maxHeight,
    method: 'upgma',
    metric: DOSAGE_L1_MEAN,
  };
}

/**
 * `dosagesFromCalls` → `distanceMatrix` → `upgma` in one call: the exact
 * pipeline gramene-g2p's `/allelematrix-search?tree=upgma` runs
 * (`apps/api/src/brapi/genotyping.ts:469-474`).
 */
export function upgmaFromCalls(
  calls: Parameters<typeof dosagesFromCalls>[0],
  samples: readonly string[],
  variantPositions: readonly number[],
): UpgmaResult {
  const dosages = dosagesFromCalls(calls, samples, variantPositions);
  const dist = distanceMatrix(dosages, samples.length, variantPositions.length);
  return upgma(samples, dist);
}
