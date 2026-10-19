/**
 * Legacy oracle: gramene-search `src/components/results/details/Homology.js`
 * lines 107-137 (`getGenomePrunedIds`), ported to a pure function of
 * (tree, activeTaxonIds, keepGeneId). The component read `activeIds` from
 * `props.grameneGenomes.active` and `keepGeneId` from `this.gene._id`; the
 * body below is otherwise preserved line for line (type annotations and the
 * `!` the strict flags require aside). Used by the parity tests; NOT part of
 * the library.
 */
import type { Tree } from '../../src/types';

export function getGenomePrunedIds(
  tree: Tree | null | undefined,
  activeTaxonIds: Set<string>,
  keepGeneId: string | undefined,
): string[] {
  const activeIds = Array.from(activeTaxonIds);
  if (activeIds.length === 0) return [];
  if (!tree) return [];
  const activeSet = new Set(activeIds.map(String));
  const nodes = tree.nodes;
  const children: Record<string, string[]> = {};
  Object.values(nodes).forEach(n => {
    if (n.parentId != null) (children[n.parentId] = children[n.parentId] || []).push(n.id);
  });
  // hasKept(node): does the subtree contain a leaf we must keep (its taxon
  // is active, or it's the gene of interest)? Memoised post-order walk.
  const memo: Record<string, boolean> = {};
  const hasKept = (id: string): boolean => {
    if (id in memo) return memo[id]!;
    const n = nodes[id]!;
    const v = n.isLeaf
      ? ((n.taxonomyId != null && activeSet.has(String(n.taxonomyId))) || n.geneId === keepGeneId)
      : (children[id] || []).some(hasKept);
    memo[id] = v;
    return v;
  };
  // A node is a maximal excluded clade when it keeps nothing but its parent
  // does (or it's the root) — i.e. the highest fully-excluded node on its
  // path. The root always keeps the gene of interest, so it is never pruned.
  return Object.values(nodes)
    .filter(n => !hasKept(n.id) && (n.parentId == null || hasKept(n.parentId)))
    .map(n => n.id);
}
