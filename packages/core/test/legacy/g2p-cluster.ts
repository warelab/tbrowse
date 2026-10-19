/**
 * UPGMA hierarchical clustering for genotype data — server-side mirror of
 * apps/ui/src/lib/cluster.ts. Two copies for now; a future cleanup can
 * extract them into a shared `packages/cluster` workspace package.
 *
 * Distance metric: mean absolute difference of allele dosages across the
 * supplied variants. Dosage = (# non-zero alleles) / ploidy ∈ {0, 0.5, 1}.
 * Pairs skip variants where either side is missing so a sample with sparse
 * coverage doesn't pull everyone toward zero distance.
 *
 * Newick output is ultrametric (all leaves at distance 0 from the root via
 * branch lengths), as UPGMA produces.
 */

export type TreeNode =
  | { kind: "leaf"; sample: string; height: 0; size: 1 }
  | { kind: "internal"; left: TreeNode; right: TreeNode; height: number; size: number };

export function distanceMatrix(
  dosages: Float32Array,
  numSamples: number,
  numVariants: number
): Float32Array {
  const m = new Float32Array(numSamples * numSamples);
  for (let i = 0; i < numSamples; i++) {
    for (let j = i + 1; j < numSamples; j++) {
      let sum = 0, count = 0;
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

export function upgma(samples: string[], dist: Float32Array): TreeNode {
  const n = samples.length;
  if (n === 0) throw new Error("upgma: no samples");
  if (n === 1) return { kind: "leaf", sample: samples[0]!, height: 0, size: 1 };

  const clusters: TreeNode[] = samples.map((s) => ({ kind: "leaf", sample: s, height: 0, size: 1 }));
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    m[i] = new Array(n);
    for (let j = 0; j < n; j++) m[i]![j] = dist[i * n + j]!;
  }
  let active = clusters.length;
  const aliveIdx: number[] = clusters.map((_, i) => i);

  while (active > 1) {
    let minA = 0, minB = 1, minD = Infinity;
    for (let a = 0; a < active; a++) {
      for (let b = a + 1; b < active; b++) {
        const d = m[aliveIdx[a]!]![aliveIdx[b]!]!;
        if (d < minD) { minD = d; minA = a; minB = b; }
      }
    }
    const i = aliveIdx[minA]!;
    const j = aliveIdx[minB]!;
    const ci = clusters[i]!;
    const cj = clusters[j]!;
    const merged: TreeNode = {
      kind: "internal", left: ci, right: cj,
      height: minD / 2, size: ci.size + cj.size
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
  return clusters[aliveIdx[0]!]!;
}

export function leafOrder(node: TreeNode, out: string[] = []): string[] {
  if (node.kind === "leaf") { out.push(node.sample); return out; }
  leafOrder(node.left, out);
  leafOrder(node.right, out);
  return out;
}

/**
 * Newick serialization. Branch length = parent.height − child.height; the
 * root carries no branch-length suffix. Sample names containing whitespace
 * or Newick punctuation get quoted.
 */
export function toNewick(root: TreeNode): string {
  const visit = (n: TreeNode, parentHeight: number): string => {
    const branchLen = (parentHeight - n.height).toFixed(6);
    if (n.kind === "leaf") return `${quote(n.sample)}:${branchLen}`;
    return `(${visit(n.left, n.height)},${visit(n.right, n.height)}):${branchLen}`;
  };
  if (root.kind === "leaf") return `${quote(root.sample)};`;
  return `(${visit(root.left, root.height)},${visit(root.right, root.height)});`;
}

function quote(name: string): string {
  if (/[\s,():;'\[\]]/.test(name)) return `'${name.replace(/'/g, "''")}'`;
  return name;
}

/**
 * Build a per-(variant, sample) dosage matrix directly from RegionCalls.
 * Layout: row-major [variantIdx * numSamples + sampleIdx]. Missing → NaN.
 */
export function dosagesFromCalls(
  calls: ReadonlyArray<{ sample: string; pos: number; GT?: Array<number | null> | null }>,
  samples: string[],
  variantPositions: number[]
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
    let alt = 0, tot = 0;
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
