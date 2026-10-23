import { describe, expect, it } from 'vitest';
import { countsFromFacet, maxByNode, sumByNode } from './counts';
import { sumLeafCounts } from '../tree/rollup';
import { geneTree } from '../../test/fixtures/tree/geneTree';

describe('countsFromFacet', () => {
  it("key 'nodeId' matches facet ids against leaf node ids", () => {
    const out = countsFromFacet(geneTree, ['g1', 2, 'g2', '3', 'g4', 10, 'nope', 99]);
    expect(out).toEqual({ g1: 2, g2: 3, n1: 5, g3: 0, g4: 10, n3: 10, g5: 0, n2: 10, g6: 0, n0: 15 });
  });

  it("key 'taxonomyId' matches facet ids against String(leaf.taxonomyId), fanning out per species", () => {
    const out = countsFromFacet(geneTree, [4577, 1, '39947', 4], 'taxonomyId');
    expect(out).toEqual({ g1: 0, g2: 1, n1: 1, g3: 4, g4: 4, n3: 8, g5: 1, n2: 9, g6: 0, n0: 10 });
  });

  it('an undefined facet yields zeros everywhere', () => {
    const out = countsFromFacet(geneTree, undefined);
    expect(Object.values(out).every((v) => v === 0)).toBe(true);
    expect(Object.keys(out).sort()).toEqual(Object.keys(geneTree.nodes).sort());
  });
});

describe('sumByNode / maxByNode', () => {
  const leafValues = { g1: 2, g2: 3, g4: 10, g6: 1 };

  it('sumByNode is sumLeafCounts', () => {
    expect(sumByNode(geneTree, leafValues)).toEqual(sumLeafCounts(geneTree, leafValues));
    expect(sumByNode(geneTree, leafValues)['n0']).toBe(16);
  });

  it('maxByNode takes the subtree maximum, 0 for missing leaves', () => {
    expect(maxByNode(geneTree, leafValues)).toEqual({ g1: 2, g2: 3, n1: 3, g3: 0, g4: 10, n3: 10, g5: 0, n2: 10, g6: 1, n0: 10 });
  });

  it('maxByNode handles negative values', () => {
    const out = maxByNode(geneTree, { g1: -5, g2: -2, g3: -1, g4: -4, g5: -9, g6: -3 });
    expect(out['n1']).toBe(-2);
    expect(out['n3']).toBe(-1);
    expect(out['n0']).toBe(-1);
  });
});
