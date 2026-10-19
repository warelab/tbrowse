import { describe, expect, it } from 'vitest';
import { leavesFailing, maximalExcludedClades, rollUp, sumLeafCounts } from './rollup';
import { buildChildrenIndex } from './index';
import { geneTree } from '../../test/fixtures/tree/geneTree';

describe('rollUp', () => {
  it('passes child values in child order and the node to combine', () => {
    const seen: Array<[string, string[]]> = [];
    const out = rollUp(
      geneTree,
      (leaf) => leaf.id,
      (childValues, node) => {
        seen.push([node.id, childValues]);
        return `${node.id}(${childValues.join(',')})`;
      },
    );
    expect(out['n3']).toBe('n3(g3,g4)');
    expect(out['n2']).toBe('n2(n3(g3,g4),g5)');
    expect(out['n0']).toBe('n0(n1(g1,g2),n2(n3(g3,g4),g5),g6)');
    expect(out['g1']).toBe('g1');
    // post-order: n1 before n3 before n2 before n0
    expect(seen.map(([id]) => id)).toEqual(['n1', 'n3', 'n2', 'n0']);
  });

  it('accepts a prebuilt childrenIndex and omits unreachable nodes', () => {
    const tree = {
      rootId: 'r',
      nodes: {
        ...geneTree.nodes,
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        x: { id: 'x', parentId: 'r', distance: 1, isLeaf: true },
      },
    };
    const out = rollUp(tree, () => 1, (vals) => vals.length, { childrenIndex: buildChildrenIndex(tree) });
    expect(out).toEqual({ x: 1, r: 1 });
  });

  it('calls combine with [] for an internal node without children', () => {
    const tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true },
        e: { id: 'e', parentId: 'r', distance: 1, isLeaf: false },
      },
    };
    const out = rollUp(tree, () => 5, (vals) => (vals.length === 0 ? -1 : vals.reduce((s, v) => s + v, 0)));
    expect(out).toEqual({ a: 5, e: -1, r: 4 });
  });
});

describe('sumLeafCounts', () => {
  it('sums leaf counts up the tree, missing leaves count 0', () => {
    const out = sumLeafCounts(geneTree, { g1: 2, g2: 3, g4: 10, g6: 1 });
    expect(out).toEqual({ g1: 2, g2: 3, n1: 5, g3: 0, g4: 10, n3: 10, g5: 0, n2: 10, g6: 1, n0: 16 });
  });
});

describe('maximalExcludedClades', () => {
  it('returns the highest nodes keeping nothing, one per clade', () => {
    const active = new Set(['4558', '4577']); // sorghum + maize
    const out = maximalExcludedClades(geneTree, (leaf) => active.has(String(leaf.taxonomyId)));
    // n3 (both rice leaves) is reported as one clade; g6 alone.
    expect(out).toEqual(['n3', 'g6']);
  });

  it('a kept gene of interest keeps its clade', () => {
    const active = new Set(['4558']);
    const out = maximalExcludedClades(
      geneTree,
      (leaf) => active.has(String(leaf.taxonomyId)) || leaf.geneId === 'OS_2',
    );
    expect(out).toEqual(['g2', 'g3', 'g5', 'g6']);
  });

  it('returns [rootId] when no leaf is kept', () => {
    expect(maximalExcludedClades(geneTree, () => false)).toEqual([geneTree.rootId]);
  });

  it('returns [] when every leaf is kept', () => {
    expect(maximalExcludedClades(geneTree, () => true, buildChildrenIndex(geneTree))).toEqual([]);
  });
});

describe('leavesFailing', () => {
  it('lists rejected leaves in tree order', () => {
    const keep = new Set(['g2', 'g4', 'g6']);
    expect(leavesFailing(geneTree, (leaf) => keep.has(leaf.id))).toEqual(['g1', 'g3', 'g5']);
    expect(leavesFailing(geneTree, () => true)).toEqual([]);
    expect(leavesFailing(geneTree, () => false)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
  });
});
