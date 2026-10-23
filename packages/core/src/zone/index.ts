/**
 * `tbrowse-core/zone` — pure helpers for writing a tbrowse zone: row flags
 * and virtualisation arithmetic, per-leaf / per-taxon joins, and facet
 * count roll-ups. Nothing here names a CSS variable; the viewer's
 * `rowHighlightBackground` / `rowsWithFlags` build on these.
 */
export type { RowFlags } from './rows';
export { rowFlags, rowsTotalHeight, rowsInRange } from './rows';
export { leafNodeIdByGeneId, geneIdByLeafNodeId, joinByLeaf, joinByTaxon } from './join';
export { countsFromFacet, sumByNode, maxByNode } from './counts';
