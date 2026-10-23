import type { GeneId, NodeId, Tree } from '../types';

/**
 * Map from `geneId` to leaf node id for every leaf that carries a gene id
 * (later leaves win on duplicate gene ids, as in the original). This is the
 * `nodeOf` map every gramene-search zone builds to key per-gene documents
 * by row.
 * Origin: gramene-search `details/exprAttrsZone.js:34-38` (`nodeOf`).
 */
export function leafNodeIdByGeneId(tree: Tree): Record<GeneId, NodeId> {
  const nodeOf: Record<GeneId, NodeId> = {};
  for (const n of Object.values(tree.nodes)) {
    if (n.isLeaf && n.geneId) nodeOf[n.geneId] = n.id;
  }
  return nodeOf;
}

/**
 * The inverse of `leafNodeIdByGeneId`: leaf node id → `geneId`, for every
 * leaf with a gene id (the hover readout map).
 * Origin: gramene-search `details/exprAttrsZone.js:34-38` (`nodeGene`).
 */
export function geneIdByLeafNodeId(tree: Tree): Record<NodeId, GeneId> {
  const nodeGene: Record<NodeId, GeneId> = {};
  for (const n of Object.values(tree.nodes)) {
    if (n.isLeaf && n.geneId) nodeGene[n.id] = n.geneId;
  }
  return nodeGene;
}

/**
 * Re-key per-gene values by leaf node id. Gene ids with no matching leaf
 * are dropped from `byNode` and listed in `unmatched` (in input order) —
 * the original silently skipped such documents.
 * Origin: gramene-search `details/exprAttrsZone.js:44-54`.
 */
export function joinByLeaf<T>(tree: Tree, byGeneId: Record<GeneId, T>): { byNode: Record<NodeId, T>; unmatched: GeneId[] } {
  const nodeOf = leafNodeIdByGeneId(tree);
  const byNode: Record<NodeId, T> = {};
  const unmatched: GeneId[] = [];
  for (const geneId of Object.keys(byGeneId)) {
    const nodeId = nodeOf[geneId];
    if (nodeId === undefined) {
      unmatched.push(geneId);
      continue;
    }
    byNode[nodeId] = byGeneId[geneId]!;
  }
  return { byNode, unmatched };
}

/**
 * Re-key per-taxon values by node id. Every node carrying a `taxonomyId`
 * (leaf or internal — a taxonomy tree has one per node, a gene tree one
 * per leaf) receives the value stored under `String(taxonomyId)`, so one
 * species' value fans out to all of its genes. Keys matching no node are
 * listed in `unmatched` (in input order). Both sides are compared as
 * strings, so numeric and string taxon ids interoperate.
 */
export function joinByTaxon<T>(tree: Tree, byTaxonId: Record<string, T>): { byNode: Record<NodeId, T>; unmatched: string[] } {
  const byNode: Record<NodeId, T> = {};
  const matched = new Set<string>();
  for (const n of Object.values(tree.nodes)) {
    if (n.taxonomyId === undefined) continue;
    const key = String(n.taxonomyId);
    if (!Object.prototype.hasOwnProperty.call(byTaxonId, key)) continue;
    byNode[n.id] = byTaxonId[key]!;
    matched.add(key);
  }
  const unmatched: string[] = [];
  for (const key of Object.keys(byTaxonId)) if (!matched.has(key)) unmatched.push(key);
  return { byNode, unmatched };
}
