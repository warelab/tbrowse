/**
 * Legacy oracle: gramene-search `src/components/results/taxTree/countsZone.js`
 * lines 20-53 (`computeGeneCounts`), ported to TypeScript line for line.
 * Only type annotations and the `!` the strict flags require were added.
 * Used by the parity tests; NOT part of the library.
 */
import type { Tree } from '../../src/types';

/**
 * Sum the taxon_id facet counts up the tree so every node (not just leaves)
 * has a total. Leaf counts come straight from the facet; internal nodes get
 * the sum over their descendant leaves — which is what a collapsed-summary row
 * should display.
 */
export function computeGeneCounts(tree: Tree | null | undefined, taxonIdFacet: unknown): Record<string, number> {
  if (!tree || !tree.nodes) return {};
  const leafCount: Record<string, number> = {};
  if (Array.isArray(taxonIdFacet)) {
    for (let i = 0; i < taxonIdFacet.length; i += 2) {
      leafCount[String(taxonIdFacet[i])] = +taxonIdFacet[i + 1];
    }
  }
  const childrenOf: Record<string, string[]> = {};
  for (const id of Object.keys(tree.nodes)) {
    const p = tree.nodes[id]!.parentId;
    if (p !== null && p !== undefined) (childrenOf[p] = childrenOf[p] || []).push(id);
  }
  const out: Record<string, number> = {};
  const visit = (id: string): number => {
    const node = tree.nodes[id];
    if (!node) return 0;
    if (node.isLeaf) {
      const c = leafCount[id] || 0;
      out[id] = c;
      return c;
    }
    let sum = 0;
    for (const k of (childrenOf[id] || [])) sum += visit(k);
    out[id] = sum;
    return sum;
  };
  visit(tree.rootId);
  return out;
}
