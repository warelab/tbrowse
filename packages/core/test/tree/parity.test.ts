/**
 * Parity tests: the new tree helpers against verbatim copies / line-for-line
 * ports of the consumer code they replace (`test/legacy/*`).
 */
import { describe, expect, it } from 'vitest';
import { computeGeneCounts } from '../legacy/countsZone-computeGeneCounts';
import { getGenomePrunedIds } from '../legacy/homology-getGenomePrunedIds';
import {
  leafOrder as legacyLeafOrder,
  toNewick as legacyToNewick,
  upgma as legacyUpgma,
  type TreeNode as LegacyTreeNode,
} from '../legacy/g2p-cluster';
import { geneTree } from '../fixtures/tree/geneTree';
import { taxDistModel, taxonIdFacet } from '../fixtures/tree/taxDistModel';
import { fromTreeModel } from '../../src/tree/hierarchy';
import { leavesFailing, maximalExcludedClades, sumLeafCounts } from '../../src/tree/rollup';
import { countsFromFacet } from '../../src/zone/counts';
import { toNewick } from '../../src/tree/newick';
import { leafOrder } from '../../src/tree/walk';
import { pruneToLeaves } from '../../src/tree/prune';
import { nodeHeights } from '../../src/tree/index';
import { convert, mulberry32, randInt, randomDistanceMatrix } from './helpers';

describe('(1) sumLeafCounts / countsFromFacet === legacy computeGeneCounts', () => {
  const { tree } = fromTreeModel(taxDistModel);
  const expected = computeGeneCounts(tree, taxonIdFacet);

  it('the oracle rolls the facet up to the root', () => {
    expect(expected['33090']).toBe(12 + 7 + 0 + 5 + 3);
    expect(expected['4527']).toBe(5);
  });

  it('countsFromFacet (key nodeId) matches exactly', () => {
    expect(countsFromFacet(tree, taxonIdFacet)).toEqual(expected);
    expect(countsFromFacet(tree, taxonIdFacet, 'nodeId')).toEqual(expected);
  });

  it("countsFromFacet (key 'taxonomyId') matches on a taxonomy tree, where id === taxonomyId", () => {
    expect(countsFromFacet(tree, taxonIdFacet, 'taxonomyId')).toEqual(expected);
    const numeric = fromTreeModel(taxDistModel, { taxonomyIdAs: 'number' }).tree;
    expect(countsFromFacet(numeric, taxonIdFacet, 'taxonomyId')).toEqual(expected);
  });

  it('sumLeafCounts matches on the pre-parsed facet', () => {
    const leafCounts: Record<string, number> = {};
    for (let i = 0; i < taxonIdFacet.length; i += 2) leafCounts[String(taxonIdFacet[i])] = Number(taxonIdFacet[i + 1]);
    expect(sumLeafCounts(tree, leafCounts)).toEqual(expected);
  });

  it('agrees on an undefined / empty / odd-length facet', () => {
    expect(countsFromFacet(tree, undefined)).toEqual(computeGeneCounts(tree, undefined));
    expect(countsFromFacet(tree, [])).toEqual(computeGeneCounts(tree, []));
    expect(countsFromFacet(tree, ['4558'])).toEqual(computeGeneCounts(tree, ['4558']));
    expect(countsFromFacet(tree, [4558, '3', '3702', 4])).toEqual(computeGeneCounts(tree, [4558, '3', '3702', 4]));
  });
});

describe('(2) maximalExcludedClades === legacy getGenomePrunedIds', () => {
  const keepFor = (active: Set<string>, keepGeneId: string | undefined) => (leaf: { taxonomyId?: string | number; geneId?: string }) =>
    (leaf.taxonomyId != null && active.has(String(leaf.taxonomyId))) || leaf.geneId === keepGeneId;

  it('kept-gene case', () => {
    const active = new Set(['4558']);
    const expected = getGenomePrunedIds(geneTree, active, 'OS_2');
    expect(expected).toEqual(['g2', 'g3', 'g5', 'g6']);
    expect(maximalExcludedClades(geneTree, keepFor(active, 'OS_2'))).toEqual(expected);
  });

  it('maximal clade case (whole rice clade excluded)', () => {
    const active = new Set(['4558', '4577']);
    const expected = getGenomePrunedIds(geneTree, active, undefined);
    expect(expected).toEqual(['n3', 'g6']);
    expect(maximalExcludedClades(geneTree, keepFor(active, undefined))).toEqual(expected);
  });

  it('no-leaf-kept case returns [rootId] in both', () => {
    const active = new Set(['999999']);
    const expected = getGenomePrunedIds(geneTree, active, undefined);
    expect(expected).toEqual([geneTree.rootId]);
    expect(maximalExcludedClades(geneTree, keepFor(active, undefined))).toEqual(expected);
  });

  it('all-kept case', () => {
    const active = new Set(['4558', '4577', '39947', '3702']);
    expect(getGenomePrunedIds(geneTree, active, undefined)).toEqual([]);
    expect(maximalExcludedClades(geneTree, keepFor(active, undefined))).toEqual([]);
  });
});

describe('(3) leavesFailing === the TaxDist leaf filter', () => {
  const { tree, leafTaxonIds } = fromTreeModel(taxDistModel);

  // `prunedNodeIds` is consumed as a set, so parity is on the id set: the
  // legacy filter runs over `leafTaxonIds` (walk order) while `leavesFailing`
  // follows `Object.keys(tree.nodes)`, which enumerates integer-like taxon
  // ids numerically.
  const sorted = (ids: readonly string[]) => [...ids].sort();

  it('matches adapter.leafTaxonIds.filter((id) => !selected[id])', () => {
    const selected: Record<string, boolean> = { '4558': true, '39946': true, '3702': false };
    const expected = leafTaxonIds.filter((id) => !selected[id]);
    expect(expected).toEqual(['4577', '39947', '3702']);
    expect(sorted(leavesFailing(tree, (leaf) => !!selected[leaf.id]))).toEqual(sorted(expected));
  });

  it('empty selection prunes every leaf; full selection none', () => {
    const none: Record<string, boolean> = {};
    expect(sorted(leavesFailing(tree, (leaf) => !!none[leaf.id]))).toEqual(sorted(leafTaxonIds.filter((id) => !none[id])));
    const all = Object.fromEntries(leafTaxonIds.map((id) => [id, true]));
    expect(leavesFailing(tree, (leaf) => !!all[leaf.id])).toEqual([]);
  });
});

describe('(4) toNewick(convert(legacy upgma)) === legacy toNewick', () => {
  it('byte-for-byte on random distance matrices', () => {
    const rand = mulberry32(2024);
    for (let trial = 0; trial < 30; trial++) {
      const n = 1 + randInt(rand, 25);
      const samples = Array.from({ length: n }, (_, i) => {
        // Mix plain, spaced and punctuated names so quoting is exercised.
        const r = rand();
        return r < 0.6 ? `S${i}` : r < 0.8 ? `sample ${i}` : `s(${i})'x`;
      });
      const dist = randomDistanceMatrix(rand, n);
      const legacyTree = legacyUpgma(samples, dist);
      const tree = convert(legacyTree);
      expect(toNewick(tree)).toBe(legacyToNewick(legacyTree));
      expect(leafOrder(tree)).toEqual(legacyLeafOrder(legacyTree));
      expect(nodeHeights(tree).maxHeight).toBeCloseTo(legacyTree.height, 9);
    }
  });

  it('convert() assigns internal ids in merge (post-order) order', () => {
    const samples = ['a', 'b', 'c', 'd'];
    const dist = new Float32Array([
      0, 1, 4, 4,
      1, 0, 4, 4,
      4, 4, 0, 2,
      4, 4, 2, 0,
    ]);
    const tree = convert(legacyUpgma(samples, dist));
    // merges: (a,b)=c0, (c,d)=c1, root=c2
    expect(Object.keys(tree.nodes)).toEqual(['a', 'b', 'c0', 'c', 'd', 'c1', 'c2']);
    expect(tree.rootId).toBe('c2');
    expect(toNewick(tree)).toBe('((a:0.500000,b:0.500000):1.500000,(c:1.000000,d:1.000000):1.000000);');
  });
});

describe('(6) pruneToLeaves === legacy pruneToSamples on binary trees', () => {
  /** gramene-g2p `apps/ui/src/pages/Genotypes.tsx:530-538`, verbatim. */
  function pruneToSamples(node: LegacyTreeNode, keep: Set<string>): LegacyTreeNode | null {
    if (node.kind === 'leaf') return keep.has(node.sample) ? node : null;
    const L = pruneToSamples(node.left, keep);
    const R = pruneToSamples(node.right, keep);
    if (L && R) {
      return { kind: 'internal', left: L, right: R, height: node.height, size: L.size + R.size };
    }
    return L ?? R ?? null;
  }

  it('same Newick (summed branch lengths), same leaf order, null when nothing is kept', () => {
    const rand = mulberry32(99);
    for (let trial = 0; trial < 40; trial++) {
      const n = 2 + randInt(rand, 20);
      const samples = Array.from({ length: n }, (_, i) => `S${i}`);
      const legacyTree = legacyUpgma(samples, randomDistanceMatrix(rand, n));
      const tree = convert(legacyTree);
      const keep = new Set(samples.filter(() => rand() < 0.5));
      const expected = pruneToSamples(legacyTree, keep);
      const got = pruneToLeaves(tree, keep);
      if (expected === null) {
        expect(keep.size).toBe(0);
        expect(got).toBeNull();
        continue;
      }
      expect(got).not.toBeNull();
      expect(toNewick(got!)).toBe(legacyToNewick(expected));
      expect(leafOrder(got!)).toEqual(legacyLeafOrder(expected));
      expect(nodeHeights(got!).maxHeight).toBeCloseTo(expected.height, 9);
    }
  });

  it('hand case: root spliced down, unary chain summed', () => {
    const samples = ['a', 'b', 'c', 'd'];
    const dist = new Float32Array([
      0, 1, 4, 4,
      1, 0, 4, 4,
      4, 4, 0, 2,
      4, 4, 2, 0,
    ]);
    const legacyTree = legacyUpgma(samples, dist);
    const tree = convert(legacyTree);
    const keep = new Set(['a', 'c', 'd']);
    expect(toNewick(pruneToLeaves(tree, keep)!)).toBe(legacyToNewick(pruneToSamples(legacyTree, keep)!));
    expect(toNewick(pruneToLeaves(tree, keep)!)).toBe('(a:2.000000,(c:1.000000,d:1.000000):1.000000);');
    const only = new Set(['d']);
    expect(toNewick(pruneToLeaves(tree, only)!)).toBe(legacyToNewick(pruneToSamples(legacyTree, only)!));
    expect(toNewick(pruneToLeaves(tree, only)!)).toBe('d;');
  });
});
