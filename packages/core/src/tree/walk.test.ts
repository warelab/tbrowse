import { describe, expect, it } from 'vitest';
import { leafOrder, postorder, preorder } from './walk';
import { buildChildrenIndex, leafIdsOf } from './index';
import type { Tree } from '../types';
import { mulberry32, randomBinaryTree } from '../../test/tree/helpers';

//   n0
//   ├── n1
//   │   ├── n3
//   │   │   ├── n4 (leaf)
//   │   │   └── n5 (leaf)
//   │   └── n8
//   │       ├── n6 (leaf)
//   │       └── n7 (leaf)
//   └── n2 (leaf)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true },
    n3: { id: 'n3', parentId: 'n1', distance: 1, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true },
    n8: { id: 'n8', parentId: 'n1', distance: 1, isLeaf: false },
    n6: { id: 'n6', parentId: 'n8', distance: 1, isLeaf: true },
    n7: { id: 'n7', parentId: 'n8', distance: 1, isLeaf: true },
  },
};

describe('preorder', () => {
  it('visits a node before its children, children in insertion order', () => {
    expect(preorder(tree)).toEqual(['n0', 'n1', 'n3', 'n4', 'n5', 'n8', 'n6', 'n7', 'n2']);
  });

  it('reverses the children of swapped nodes', () => {
    expect(preorder(tree, { swappedNodeIds: new Set(['n0']) })).toEqual([
      'n0', 'n2', 'n1', 'n3', 'n4', 'n5', 'n8', 'n6', 'n7',
    ]);
    expect(preorder(tree, { swappedNodeIds: new Set(['n1', 'n3']) })).toEqual([
      'n0', 'n1', 'n8', 'n6', 'n7', 'n3', 'n5', 'n4', 'n2',
    ]);
  });

  it('honours rootId and a supplied childrenIndex', () => {
    const childrenIndex = buildChildrenIndex(tree);
    expect(preorder(tree, { rootId: 'n8', childrenIndex })).toEqual(['n8', 'n6', 'n7']);
    expect(preorder(tree, { rootId: 'n2' })).toEqual(['n2']);
  });

  it('skips ids that are not in the tree', () => {
    expect(preorder(tree, { rootId: 'ghost' })).toEqual([]);
    const withGhost: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true },
      },
    };
    expect(preorder(withGhost)).toEqual(['r', 'a']);
  });
});

describe('postorder', () => {
  it('visits children before their parent', () => {
    expect(postorder(tree)).toEqual(['n4', 'n5', 'n3', 'n6', 'n7', 'n8', 'n1', 'n2', 'n0']);
  });

  it('reverses the children of swapped nodes', () => {
    expect(postorder(tree, { swappedNodeIds: new Set(['n0', 'n8']) })).toEqual([
      'n2', 'n4', 'n5', 'n3', 'n7', 'n6', 'n8', 'n1', 'n0',
    ]);
  });

  it('honours rootId', () => {
    expect(postorder(tree, { rootId: 'n3' })).toEqual(['n4', 'n5', 'n3']);
  });
});

describe('leafOrder', () => {
  it('equals leafIdsOf without swaps', () => {
    expect(leafOrder(tree)).toEqual(['n4', 'n5', 'n6', 'n7', 'n2']);
    expect(leafOrder(tree)).toEqual(leafIdsOf(tree));
  });

  it('applies swaps', () => {
    expect(leafOrder(tree, { swappedNodeIds: new Set(['n0']) })).toEqual(['n2', 'n4', 'n5', 'n6', 'n7']);
    expect(leafOrder(tree, { swappedNodeIds: new Set(['n1', 'n3']) })).toEqual(['n6', 'n7', 'n5', 'n4', 'n2']);
  });

  it('is the leaf subsequence of preorder, with and without swaps', () => {
    const swapped = new Set(['n1', 'n8']);
    const leavesOf = (ids: string[]) => ids.filter((id) => tree.nodes[id]!.isLeaf);
    expect(leafOrder(tree)).toEqual(leavesOf(preorder(tree)));
    expect(leafOrder(tree, { swappedNodeIds: swapped })).toEqual(leavesOf(preorder(tree, { swappedNodeIds: swapped })));
  });
});

describe('walk invariants on random binary trees', () => {
  it('preorder and postorder each visit every node once; postorder puts children first', () => {
    const rand = mulberry32(7);
    for (let trial = 0; trial < 20; trial++) {
      const t = randomBinaryTree(rand, 2 + Math.floor(rand() * 30));
      const all = Object.keys(t.nodes).sort();
      const pre = preorder(t);
      const post = postorder(t);
      expect([...pre].sort()).toEqual(all);
      expect([...post].sort()).toEqual(all);
      const pos = new Map(post.map((id, i) => [id, i]));
      const prePos = new Map(pre.map((id, i) => [id, i]));
      for (const n of Object.values(t.nodes)) {
        if (n.parentId === null) continue;
        expect(pos.get(n.id)!).toBeLessThan(pos.get(n.parentId)!);
        expect(prePos.get(n.id)!).toBeGreaterThan(prePos.get(n.parentId)!);
      }
    }
  });
});
