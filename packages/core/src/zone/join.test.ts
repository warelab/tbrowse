import { describe, expect, it } from 'vitest';
import { geneIdByLeafNodeId, joinByLeaf, joinByTaxon, leafNodeIdByGeneId } from './join';
import { geneTree } from '../../test/fixtures/tree/geneTree';
import { fromTreeModel } from '../tree/hierarchy';
import { taxDistModel } from '../../test/fixtures/tree/taxDistModel';
import type { Tree } from '../types';

describe('leafNodeIdByGeneId / geneIdByLeafNodeId', () => {
  it('map leaves both ways, ignoring internals and leaves without a geneId', () => {
    const tree: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false, geneId: 'INTERNAL_WITH_GENE' },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true, geneId: 'GA' },
        b: { id: 'b', parentId: 'r', distance: 1, isLeaf: true },
        c: { id: 'c', parentId: 'r', distance: 1, isLeaf: true, geneId: 'GC' },
      },
    };
    expect(leafNodeIdByGeneId(tree)).toEqual({ GA: 'a', GC: 'c' });
    expect(geneIdByLeafNodeId(tree)).toEqual({ a: 'GA', c: 'GC' });
  });

  it('later leaves win on duplicate gene ids (as the original did)', () => {
    const tree: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true, geneId: 'G' },
        b: { id: 'b', parentId: 'r', distance: 1, isLeaf: true, geneId: 'G' },
      },
    };
    expect(leafNodeIdByGeneId(tree)).toEqual({ G: 'b' });
    expect(geneIdByLeafNodeId(tree)).toEqual({ a: 'G', b: 'G' });
  });
});

describe('joinByLeaf', () => {
  it('re-keys by leaf node id and lists unmatched gene ids in input order', () => {
    const { byNode, unmatched } = joinByLeaf(geneTree, { OS_2: 'rice2', NOPE: 'x', SORBI_1: 'sorg', ZZ: 'y' });
    expect(byNode).toEqual({ g4: 'rice2', g1: 'sorg' });
    expect(unmatched).toEqual(['NOPE', 'ZZ']);
  });

  it('handles empty input', () => {
    expect(joinByLeaf(geneTree, {})).toEqual({ byNode: {}, unmatched: [] });
  });
});

describe('joinByTaxon', () => {
  it('fans one taxon value out to every node with that taxonomyId, comparing as strings', () => {
    const { byNode, unmatched } = joinByTaxon(geneTree, { '4577': 'maize', '39947': 'rice', '1': 'nobody' });
    expect(byNode).toEqual({ g2: 'maize', g5: 'maize', g3: 'rice', g4: 'rice' });
    expect(unmatched).toEqual(['1']);
  });

  it('on a taxonomy tree internal nodes join too (string and numeric ids alike)', () => {
    const stringTree = fromTreeModel(taxDistModel).tree;
    const numberTree = fromTreeModel(taxDistModel, { taxonomyIdAs: 'number' }).tree;
    const values = { '4479': 'grasses', '4558': 'sorghum' };
    const expected = { byNode: { '4479': 'grasses', '4558': 'sorghum' }, unmatched: [] };
    expect(joinByTaxon(stringTree, values)).toEqual(expected);
    expect(joinByTaxon(numberTree, values)).toEqual(expected);
  });
});
