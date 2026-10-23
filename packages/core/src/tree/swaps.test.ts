import { describe, expect, it } from 'vitest';
import { swapsForLeafOrder } from './swaps';
import { leafOrder } from './walk';
import type { Tree } from '../types';
import { mulberry32, randInt, randomBinaryTree } from '../../test/tree/helpers';

//   n0
//   ├── n1
//   │   ├── n3
//   │   │   ├── n4 (leaf, GENE_HUMAN)
//   │   │   └── n5 (leaf, GENE_CHIMP)
//   │   └── n8
//   │       ├── n6 (leaf, GENE_MOUSE)
//   │       └── n7 (leaf, GENE_RAT)
//   └── n2 (leaf, GENE_FISH)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true, geneId: 'GENE_FISH' },
    n3: { id: 'n3', parentId: 'n1', distance: 1, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true, geneId: 'GENE_HUMAN' },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true, geneId: 'GENE_CHIMP' },
    n8: { id: 'n8', parentId: 'n1', distance: 1, isLeaf: false },
    n6: { id: 'n6', parentId: 'n8', distance: 1, isLeaf: true, geneId: 'GENE_MOUSE' },
    n7: { id: 'n7', parentId: 'n8', distance: 1, isLeaf: true, geneId: 'GENE_RAT' },
  },
};

describe('swapsForLeafOrder', () => {
  it('returns no swaps for the native order', () => {
    const out = swapsForLeafOrder(tree, ['GENE_HUMAN', 'GENE_CHIMP', 'GENE_MOUSE', 'GENE_RAT', 'GENE_FISH']);
    expect(out).toEqual({ swappedNodeIds: [], unmatched: [] });
  });

  it('finds the nodes to flip and reproduces the order through leafOrder', () => {
    const want = ['GENE_FISH', 'GENE_RAT', 'GENE_MOUSE', 'GENE_HUMAN', 'GENE_CHIMP'];
    const out = swapsForLeafOrder(tree, want);
    expect([...out.swappedNodeIds].sort()).toEqual(['n0', 'n1', 'n8']);
    expect(out.unmatched).toEqual([]);
    const got = leafOrder(tree, { swappedNodeIds: new Set(out.swappedNodeIds) }).map((id) => tree.nodes[id]!.geneId);
    expect(got).toEqual(want);
  });

  it('lists unknown labels in unmatched and ignores missing leaves', () => {
    const out = swapsForLeafOrder(tree, ['GENE_FISH', 'NOPE', 'GENE_HUMAN', 'ALSO_NOPE']);
    expect(out.unmatched).toEqual(['NOPE', 'ALSO_NOPE']);
    expect(out.swappedNodeIds).toEqual(['n0']);
  });

  it('uses a custom key', () => {
    const out = swapsForLeafOrder(tree, ['n2', 'n4', 'n5', 'n6', 'n7'], (leaf) => leaf.id);
    expect(out).toEqual({ swappedNodeIds: ['n0'], unmatched: [] });
  });

  it('round-trips random swap sets on random binary trees', () => {
    const rand = mulberry32(12345);
    for (let trial = 0; trial < 50; trial++) {
      const t = randomBinaryTree(rand, 2 + randInt(rand, 40));
      const internals = Object.values(t.nodes).filter((n) => !n.isLeaf).map((n) => n.id);
      const swapped = new Set(internals.filter(() => rand() < 0.5));
      const want = leafOrder(t, { swappedNodeIds: swapped }).map((id) => t.nodes[id]!.geneId!);
      const out = swapsForLeafOrder(t, want);
      expect(out.unmatched).toEqual([]);
      const got = leafOrder(t, { swappedNodeIds: new Set(out.swappedNodeIds) }).map((id) => t.nodes[id]!.geneId!);
      expect(got).toEqual(want);
      // For a binary tree the realising swap set is unique.
      expect([...out.swappedNodeIds].sort()).toEqual([...swapped].sort());
    }
  });
});
