import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computePivotState } from './pivot';
import type { Tree } from './types';

// Binary tree:
//   n0
//   ├── n1
//   │   ├── n3
//   │   │   ├── n4 (leaf, geneId GENE_HUMAN)
//   │   │   └── n5 (leaf, geneId GENE_CHIMP)
//   │   └── n8
//   │       ├── n6 (leaf, geneId GENE_MOUSE)
//   │       └── n7 (leaf, geneId GENE_RAT)
//   └── n2 (leaf, geneId GENE_FISH)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true,  geneId: 'GENE_FISH' },
    n3: { id: 'n3', parentId: 'n1', distance: 1, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true,  geneId: 'GENE_HUMAN' },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true,  geneId: 'GENE_CHIMP' },
    n8: { id: 'n8', parentId: 'n1', distance: 1, isLeaf: false },
    n6: { id: 'n6', parentId: 'n8', distance: 1, isLeaf: true,  geneId: 'GENE_MOUSE' },
    n7: { id: 'n7', parentId: 'n8', distance: 1, isLeaf: true,  geneId: 'GENE_RAT' },
  },
};

describe('computePivotState', () => {
  it('resolves by leaf geneId — human is on the topmost path, no swap needed', () => {
    const result = computePivotState(tree, 'GENE_HUMAN');
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe('n4');
    // Path n0 → n1 → n3 → n4. Each ancestor's path-child is its first child:
    //   n0.children = [n1, n2] (path: n1 at idx 0)
    //   n1.children = [n3, n8] (path: n3 at idx 0)
    //   n3.children = [n4, n5] (path: n4 at idx 0)
    expect(result!.swappedNodeIds).toEqual([]);
    // Non-path internal siblings collapse: n8 (sibling of n3 under n1).
    // Leaf siblings (n5 of n4, n2 of n1) are NOT collapsed.
    expect(result!.collapsedNodeIds).toEqual(['n8']);
  });

  it('swaps ancestors whose path-child is not at index 0', () => {
    const result = computePivotState(tree, 'GENE_FISH');
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe('n2');
    // Path n0 → n2. n2 is at index 1 of n0's children → swap n0.
    expect(result!.swappedNodeIds).toEqual(['n0']);
    // n1 is the non-path sibling of n2 under n0 — internal → collapsed.
    expect(result!.collapsedNodeIds).toEqual(['n1']);
  });

  it('swaps multiple ancestors when path-child index is non-zero each time', () => {
    // Path n0 → n1 → n8 → n7.
    //   n0.children = [n1, n2] — path-child n1 at idx 0 → no swap.
    //   n1.children = [n3, n8] — path-child n8 at idx 1 → SWAP n1.
    //   n8.children = [n6, n7] — path-child n7 at idx 1 → SWAP n8.
    const result = computePivotState(tree, 'GENE_RAT');
    expect(result).not.toBeNull();
    expect(result!.swappedNodeIds).toEqual(['n1', 'n8']);
    // Non-path internal siblings: n3 (sibling of n8 under n1).
    expect(result!.collapsedNodeIds).toEqual(['n3']);
  });

  it('falls back to node id match when no leaf geneId matches', () => {
    const result = computePivotState(tree, 'n6');
    expect(result).not.toBeNull();
    expect(result!.targetId).toBe('n6');
  });

  it('returns null and warns when neither geneId nor nodeId matches', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = computePivotState(tree, 'NOT_A_REAL_ID');
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/NOT_A_REAL_ID/);
    warn.mockRestore();
  });

  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });
});
