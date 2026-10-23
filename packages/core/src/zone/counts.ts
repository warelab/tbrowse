import type { NodeId, Tree } from '../types';
import { rollUp, sumLeafCounts } from '../tree/rollup';

/**
 * Parse a Solr facet array `[id, count, id, count, …]` into
 * `{ [String(id)]: Number(count) }`.
 * Origin: gramene-search `taxTree/countsZone.js:22-28`.
 */
function leafCountsFromFacet(facet: ReadonlyArray<string | number> | undefined): Record<string, number> {
  const leafCount: Record<string, number> = {};
  if (Array.isArray(facet)) {
    for (let i = 0; i < facet.length; i += 2) {
      leafCount[String(facet[i])] = Number(facet[i + 1]);
    }
  }
  return leafCount;
}

/**
 * Per-node gene counts from a Solr facet array `[id, count, id, count, …]`,
 * summed up the tree so collapsed clades show their subtree total. With
 * `key: 'nodeId'` (default) facet ids are matched against leaf node ids and
 * the result equals gramene-search's `computeGeneCounts(tree, facet)`
 * exactly; with `key: 'taxonomyId'` they are matched against
 * `String(leaf.taxonomyId)` instead, which is what a gene tree needs.
 * Origin: gramene-search `taxTree/countsZone.js:20-53` (`computeGeneCounts`).
 */
export function countsFromFacet(
  tree: Tree,
  facet: ReadonlyArray<string | number> | undefined,
  key: 'nodeId' | 'taxonomyId' = 'nodeId',
): Record<NodeId, number> {
  const leafCount = leafCountsFromFacet(facet);
  if (key === 'nodeId') return sumLeafCounts(tree, leafCount);
  return rollUp(
    tree,
    (leaf) => (leaf.taxonomyId !== undefined ? leafCount[String(leaf.taxonomyId)] || 0 : 0),
    (childValues) => {
      let sum = 0;
      for (const v of childValues) sum += v;
      return sum;
    },
  );
}

/**
 * Sum per-leaf numbers up the tree (`sumLeafCounts` under its zone-facing
 * name): leaves get `leafValues[id] || 0`, internal nodes the sum over
 * their children.
 */
export function sumByNode(tree: Tree, leafValues: Record<NodeId, number>): Record<NodeId, number> {
  return sumLeafCounts(tree, leafValues);
}

/**
 * Maximum per-leaf number over each subtree: leaves get `leafValues[id] || 0`,
 * internal nodes the max over their children (0 when none) — the value a
 * collapsed row should show for a "peak" style column.
 */
export function maxByNode(tree: Tree, leafValues: Record<NodeId, number>): Record<NodeId, number> {
  return rollUp(
    tree,
    (leaf) => leafValues[leaf.id] || 0,
    (childValues) => {
      let max = 0;
      let first = true;
      for (const v of childValues) {
        if (first || v > max) max = v;
        first = false;
      }
      return max;
    },
  );
}
