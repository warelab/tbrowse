import type { ChildrenIndex } from '../treeIndex';
import { countLeavesInSubtree } from '../treeIndex';
import type { HostData, NodeId } from '../types';

/**
 * Shared hover-readout text for header strips. Returns a single
 * dot-separated line, or `null` when nothing is hovered or the node
 * id doesn't resolve to anything.
 *
 * - Internal nodes: taxonomy name · rank · event type · subtree size.
 * - Leaf nodes: taxonomy name · gene id · gene name (only if defined
 *   AND distinct from the gene id, to avoid noise like "TP53 · TP53").
 */
export function describeHoveredNodeForHeader(
  nodeId: NodeId | null,
  data: HostData,
  childrenIndex: ChildrenIndex,
): string | null {
  if (!nodeId) return null;
  const node = data.tree.nodes[nodeId];
  if (!node) return nodeId;
  const tax =
    node.taxonomyId !== undefined ? data.taxonomy?.[node.taxonomyId] : undefined;
  const taxName = tax?.scientificName ?? tax?.commonName;
  const parts: string[] = [];
  if (node.isLeaf) {
    if (taxName) parts.push(taxName);
    if (node.geneId) parts.push(node.geneId);
    const meta = node.geneId ? data.geneMetadata?.[node.geneId] : undefined;
    const display = meta?.['displayName'];
    if (
      typeof display === 'string' &&
      display !== '' &&
      display !== node.geneId
    ) {
      parts.push(display);
    }
  } else {
    if (taxName) parts.push(taxName);
    if (tax?.rank) parts.push(tax.rank);
    if (node.eventType) parts.push(node.eventType);
    const size = countLeavesInSubtree(nodeId, data.tree, childrenIndex);
    parts.push(`${size} ${size === 1 ? 'leaf' : 'leaves'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
