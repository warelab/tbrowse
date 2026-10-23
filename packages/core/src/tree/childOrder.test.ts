import { describe, expect, it } from 'vitest';
import type { Tree } from '../types';
import { buildChildrenIndex, leafIdsOf } from './index';
import { leafOrder } from './walk';
import { toNewick } from './newick';

/** Children inserted as ['b', '10', '2'] under r: enumeration puts '2' and '10' first. */
const numericIds: Tree = {
  rootId: 'r',
  nodes: {
    r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
    b: { id: 'b', parentId: 'r', distance: 1, isLeaf: true },
    '10': { id: '10', parentId: 'r', distance: 1, isLeaf: true },
    '2': { id: '2', parentId: 'r', distance: 1, isLeaf: true },
  },
};

describe('child order with canonical-integer node ids', () => {
  it('follows Object.keys enumeration: integer-like ids first, ascending', () => {
    expect(leafIdsOf(numericIds)).toEqual(['2', '10', 'b']);
    expect(leafOrder(numericIds)).toEqual(['2', '10', 'b']);
    expect(toNewick(numericIds)).toBe('(2:1.000000,10:1.000000,b:1.000000);');
  });

  it('an explicitly ordered ChildrenIndex restores insertion order', () => {
    const ordered = new Map([['r', ['b', '10', '2']]]);
    expect(leafIdsOf(numericIds, { childrenIndex: ordered })).toEqual(['b', '10', '2']);
    expect(leafOrder(numericIds, { childrenIndex: ordered })).toEqual(['b', '10', '2']);
    expect(toNewick(numericIds, { childrenIndex: ordered })).toBe('(b:1.000000,10:1.000000,2:1.000000);');
  });

  it('synthetic ids with the label in geneId are immune', () => {
    const synthetic: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        l0: { id: 'l0', parentId: 'r', distance: 1, isLeaf: true, geneId: 'b' },
        l1: { id: 'l1', parentId: 'r', distance: 1, isLeaf: true, geneId: '10' },
        l2: { id: 'l2', parentId: 'r', distance: 1, isLeaf: true, geneId: '2' },
      },
    };
    expect(buildChildrenIndex(synthetic).get('r')).toEqual(['l0', 'l1', 'l2']);
    expect(toNewick(synthetic)).toBe('(b:1.000000,10:1.000000,2:1.000000);');
  });
});
