import { describe, expect, it } from 'vitest';
import {
  EMPTY_NODE_ID_SET,
  ancestorIdsOf,
  assertValidTree,
  buildChildrenIndex,
  countLeavesInSubtree,
  depthOf,
  isLeafNode,
  lca,
  leafGeneIds,
  leafIdsOf,
  nodeHeights,
  pathToRoot,
  subtreeIdsOf,
  validateTree,
} from './index';
import type { Tree } from '../types';

//   n0
//   ├── n1 (d=1)
//   │   ├── n3 (d=2)
//   │   │   ├── n4 (d=1, leaf, GENE_HUMAN)
//   │   │   └── n5 (d=1, leaf, GENE_CHIMP)
//   │   └── n8 (d=1)
//   │       ├── n6 (d=0.5, leaf, GENE_MOUSE)
//   │       └── n7 (d=0.5, leaf, no geneId)
//   └── n2 (d=3, leaf, GENE_FISH)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 3, isLeaf: true, geneId: 'GENE_FISH' },
    n3: { id: 'n3', parentId: 'n1', distance: 2, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true, geneId: 'GENE_HUMAN' },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true, geneId: 'GENE_CHIMP' },
    n8: { id: 'n8', parentId: 'n1', distance: 1, isLeaf: false },
    n6: { id: 'n6', parentId: 'n8', distance: 0.5, isLeaf: true, geneId: 'GENE_MOUSE' },
    n7: { id: 'n7', parentId: 'n8', distance: 0.5, isLeaf: true },
  },
};

describe('buildChildrenIndex / subtreeIdsOf / ancestorIdsOf', () => {
  it('indexes children in insertion order', () => {
    const idx = buildChildrenIndex(tree);
    expect(idx.get('n0')).toEqual(['n1', 'n2']);
    expect(idx.get('n1')).toEqual(['n3', 'n8']);
    expect(idx.get('n4')).toBeUndefined();
  });

  it('subtreeIdsOf includes the root and every descendant', () => {
    const idx = buildChildrenIndex(tree);
    expect([...subtreeIdsOf('n1', idx)].sort()).toEqual(['n1', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8']);
    expect([...subtreeIdsOf('n2', idx)]).toEqual(['n2']);
  });

  it('ancestorIdsOf lists strict ancestors up to the root', () => {
    expect([...ancestorIdsOf(tree, 'n6')]).toEqual(['n8', 'n1', 'n0']);
    expect(ancestorIdsOf(tree, 'n0').size).toBe(0);
    expect(ancestorIdsOf(tree, 'missing').size).toBe(0);
  });

  it('EMPTY_NODE_ID_SET is empty', () => {
    expect(EMPTY_NODE_ID_SET.size).toBe(0);
  });
});

describe('countLeavesInSubtree / leafIdsOf / leafGeneIds', () => {
  it('counts leaves', () => {
    const idx = buildChildrenIndex(tree);
    expect(countLeavesInSubtree('n0', tree, idx)).toBe(5);
    expect(countLeavesInSubtree('n1', tree, idx)).toBe(4);
    expect(countLeavesInSubtree('n2', tree, idx)).toBe(1);
    expect(countLeavesInSubtree('missing', tree, idx)).toBe(0);
  });

  it('leafIdsOf walks in child-insertion order, optionally under a subtree', () => {
    expect(leafIdsOf(tree)).toEqual(['n4', 'n5', 'n6', 'n7', 'n2']);
    expect(leafIdsOf(tree, { rootId: 'n8' })).toEqual(['n6', 'n7']);
    expect(leafIdsOf(tree, { rootId: 'n8', childrenIndex: buildChildrenIndex(tree) })).toEqual(['n6', 'n7']);
  });

  it('leafGeneIds skips leaves without a geneId', () => {
    expect(leafGeneIds(tree)).toEqual(['GENE_HUMAN', 'GENE_CHIMP', 'GENE_MOUSE', 'GENE_FISH']);
  });
});

describe('pathToRoot / lca / depthOf', () => {
  it('pathToRoot runs from the node to the root', () => {
    expect(pathToRoot(tree, 'n6')).toEqual(['n6', 'n8', 'n1', 'n0']);
    expect(pathToRoot(tree, 'n0')).toEqual(['n0']);
    expect(pathToRoot(tree, 'nope')).toEqual([]);
  });

  it('lca of leaves', () => {
    expect(lca(tree, ['n4', 'n5'])).toBe('n3');
    expect(lca(tree, ['n4', 'n6'])).toBe('n1');
    expect(lca(tree, ['n4', 'n2'])).toBe('n0');
    expect(lca(tree, ['n4'])).toBe('n4');
    expect(lca(tree, ['n1', 'n6'])).toBe('n1'); // a node is its own ancestor
  });

  it('lca is null for an empty set or an unknown id', () => {
    expect(lca(tree, [])).toBeNull();
    expect(lca(tree, ['n4', 'ghost'])).toBeNull();
  });

  it('depthOf sums branch lengths from the root', () => {
    expect(depthOf(tree, 'n0')).toBe(0);
    expect(depthOf(tree, 'n2')).toBe(3);
    expect(depthOf(tree, 'n4')).toBe(4);
    expect(depthOf(tree, 'n6')).toBe(2.5);
    expect(depthOf(tree, 'ghost')).toBeNaN();
  });
});

describe('nodeHeights', () => {
  it('reports max root distance and height = max − rootDistance', () => {
    const { heights, maxHeight } = nodeHeights(tree);
    expect(maxHeight).toBe(4);
    expect(heights['n0']).toBe(4);
    expect(heights['n4']).toBe(0);
    expect(heights['n5']).toBe(0);
    expect(heights['n2']).toBe(1);
    expect(heights['n6']).toBe(1.5);
    expect(heights['n3']).toBe(1);
  });

  it('is 0 everywhere for a single-leaf tree', () => {
    const single: Tree = { rootId: 'a', nodes: { a: { id: 'a', parentId: null, distance: 0, isLeaf: true } } };
    expect(nodeHeights(single)).toEqual({ heights: { a: 0 }, maxHeight: 0 });
  });
});

describe('validateTree / assertValidTree', () => {
  it('returns [] for a sound tree and assertValidTree does not throw', () => {
    expect(validateTree(tree)).toEqual([]);
    expect(() => assertValidTree(tree)).not.toThrow();
  });

  it('missing root', () => {
    const bad: Tree = { rootId: 'zz', nodes: tree.nodes };
    expect(validateTree(bad)).toEqual(['root "zz" is not in nodes']);
    expect(() => assertValidTree(bad)).toThrow(/root "zz" is not in nodes/);
  });

  it('root with a parent', () => {
    const bad: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: 'x', distance: 0, isLeaf: false },
        x: { id: 'x', parentId: 'r', distance: 1, isLeaf: true },
      },
    };
    expect(validateTree(bad)).toContain('root "r" has a parent');
  });

  it('orphan parent', () => {
    const bad: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true },
        b: { id: 'b', parentId: 'ghost', distance: 1, isLeaf: true },
      },
    };
    const problems = validateTree(bad);
    expect(problems).toContain('node "b" has unknown parent "ghost"');
    expect(problems).toContain('node "b" is not reachable from the root');
    expect(() => assertValidTree(bad)).toThrow(/Invalid tree/);
  });

  it('cycle', () => {
    const bad: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        x: { id: 'x', parentId: 'r', distance: 1, isLeaf: true },
        a: { id: 'a', parentId: 'b', distance: 1, isLeaf: false },
        b: { id: 'b', parentId: 'a', distance: 1, isLeaf: false },
      },
    };
    const problems = validateTree(bad);
    expect(problems.some((p) => /^cycle through/.test(p))).toBe(true);
    expect(problems).toContain('node "a" is not reachable from the root');
    expect(() => assertValidTree(bad)).toThrow(/cycle/);
  });

  it('leaf with children', () => {
    const bad: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        l: { id: 'l', parentId: 'r', distance: 1, isLeaf: true },
        c: { id: 'c', parentId: 'l', distance: 1, isLeaf: true },
      },
    };
    expect(validateTree(bad)).toEqual(['leaf "l" has 1 children']);
    expect(() => assertValidTree(bad)).toThrow(/leaf "l" has 1 children/);
  });

  it('no leaves', () => {
    const bad: Tree = { rootId: 'r', nodes: { r: { id: 'r', parentId: null, distance: 0, isLeaf: false } } };
    const problems = validateTree(bad);
    expect(problems).toContain('internal node "r" has no children');
    expect(problems).toContain('tree has no leaves');
    expect(() => assertValidTree(bad)).toThrow(/no leaves/);
  });

  it('node keyed under a different id', () => {
    const bad: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'A', parentId: 'r', distance: 1, isLeaf: true },
      },
    };
    expect(validateTree(bad)).toContain('node keyed "a" has id "A"');
  });
});

describe('isLeafNode', () => {
  it('guards on isLeaf and tolerates undefined', () => {
    expect(isLeafNode(tree.nodes['n4'])).toBe(true);
    expect(isLeafNode(tree.nodes['n0'])).toBe(false);
    expect(isLeafNode(undefined)).toBe(false);
  });
});
