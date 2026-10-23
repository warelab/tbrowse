/**
 * Test-only helpers: a seeded PRNG (so no test touches `Math.random`),
 * random binary trees, random distance matrices, and `convert()` — the
 * bridge from gramene-g2p's nested binary `TreeNode` to a flat tbrowse `Tree`
 * used by the UPGMA/Newick/prune parity tests.
 */
import type { NodeId, Tree, TreeNode } from '../../src/types';
import type { TreeNode as LegacyTreeNode } from '../legacy/g2p-cluster';

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, n). */
export function randInt(rand: () => number, n: number): number {
  return Math.floor(rand() * n);
}

/**
 * Random rooted binary tree with `nLeaves` leaves `L0…L{n-1}` (geneId = id)
 * and internal nodes `I0…`, built by repeatedly merging two random clusters.
 * Branch lengths are random in (0, 1].
 */
export function randomBinaryTree(rand: () => number, nLeaves: number): Tree {
  if (nLeaves < 1) throw new Error('randomBinaryTree: need at least one leaf');
  const nodes: Record<NodeId, TreeNode> = {};
  const clusters: NodeId[] = [];
  for (let i = 0; i < nLeaves; i++) {
    const id = `L${i}`;
    nodes[id] = { id, parentId: null, distance: 0, isLeaf: true, geneId: id };
    clusters.push(id);
  }
  let next = 0;
  while (clusters.length > 1) {
    const a = randInt(rand, clusters.length);
    let b = randInt(rand, clusters.length - 1);
    if (b >= a) b++;
    const id = `I${next++}`;
    const [first, second] = a < b ? [clusters[a]!, clusters[b]!] : [clusters[b]!, clusters[a]!];
    // Re-insert the children so insertion order (= child order) is first, second.
    const c1 = nodes[first]!;
    const c2 = nodes[second]!;
    delete nodes[first];
    delete nodes[second];
    nodes[first] = { ...c1, parentId: id, distance: rand() + 1e-3 };
    nodes[second] = { ...c2, parentId: id, distance: rand() + 1e-3 };
    nodes[id] = { id, parentId: null, distance: 0, isLeaf: false };
    clusters.splice(Math.max(a, b), 1);
    clusters.splice(Math.min(a, b), 1);
    clusters.push(id);
  }
  return { rootId: clusters[0]!, nodes };
}

/** Symmetric random distance matrix (row-major `n×n`, zero diagonal). */
export function randomDistanceMatrix(rand: () => number, n: number): Float32Array {
  const m = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.round(rand() * 1000) / 1000;
      m[i * n + j] = d;
      m[j * n + i] = d;
    }
  }
  return m;
}

/**
 * gramene-g2p nested binary tree → flat tbrowse `Tree`: leaf id = geneId =
 * sample; internal ids `c0, c1, …` assigned in post-order (merge order);
 * `distance = parent.height − child.height`; nodes inserted in post-order
 * so each internal node's children index as `[left, right]`.
 */
export function convert(root: LegacyTreeNode): Tree {
  const nodes: Record<NodeId, TreeNode> = {};
  let next = 0;
  const visit = (n: LegacyTreeNode, parentId: NodeId | null, parentHeight: number): NodeId => {
    const distance = parentId === null ? 0 : parentHeight - n.height;
    if (n.kind === 'leaf') {
      nodes[n.sample] = { id: n.sample, parentId, distance, isLeaf: true, geneId: n.sample };
      return n.sample;
    }
    // Visit the children first so the id is allocated in post-order, then
    // point them at it.
    const leftId = visit(n.left, 'pending', n.height);
    const rightId = visit(n.right, 'pending', n.height);
    const id = `c${next++}`;
    nodes[leftId]!.parentId = id;
    nodes[rightId]!.parentId = id;
    nodes[id] = { id, parentId, distance, isLeaf: false };
    return id;
  };
  const rootId = visit(root, null, root.height);
  return { rootId, nodes };
}
