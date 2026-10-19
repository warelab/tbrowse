import type { NodeId, Tree, TreeNode } from '../types';
import { buildChildrenIndex } from './index';

/** Options for `toNewick`. */
export interface ToNewickOptions {
  /**
   * Label for a node, or null for none. Default: leaves are labelled with
   * `geneId ?? id`, internal nodes carry no label (matching gramene-g2p's
   * serialiser).
   */
  label?: (node: TreeNode) => string | null;
  /** Emit `:length` after every non-root node (default true). */
  branchLengths?: boolean;
  /** Decimal places for branch lengths via `toFixed` (default 6). */
  precision?: number;
  /** Serialise only the subtree under this node (default: the tree root). */
  rootId?: NodeId;
  /** Internal nodes whose children are written in reversed order. */
  swappedNodeIds?: ReadonlySet<NodeId>;
}

function defaultLabel(node: TreeNode): string | null {
  return node.isLeaf ? (node.geneId ?? node.id) : null;
}

/**
 * Quote a Newick label when it contains whitespace or Newick punctuation
 * (`,():;'[]`), doubling embedded single quotes; otherwise return it as is.
 * Origin: gramene-g2p `apps/api/src/cluster.ts:118-121` (`quote`).
 */
export function quoteNewickLabel(label: string): string {
  if (/[\s,():;'\[\]]/.test(label)) return `'${label.replace(/'/g, "''")}'`;
  return label;
}

/**
 * Newick serialisation of a tree (or of the subtree under `rootId`): children
 * in child-insertion order (reversed for `swappedNodeIds`), `:length` from
 * each node's `distance` formatted with `toFixed(precision)`, no length on
 * the root, trailing `;`. With the defaults this reproduces gramene-g2p's
 * `toNewick` byte for byte on its binary UPGMA trees, where
 * `distance = parent.height − child.height`.
 * Origin: gramene-g2p `apps/api/src/cluster.ts:99-116` (`toNewick`).
 */
export function toNewick(tree: Tree, opts: ToNewickOptions = {}): string {
  const label = opts.label ?? defaultLabel;
  const branchLengths = opts.branchLengths ?? true;
  const precision = opts.precision ?? 6;
  const swapped = opts.swappedNodeIds;
  const childrenIndex = buildChildrenIndex(tree);
  const rootId = opts.rootId ?? tree.rootId;
  const root = tree.nodes[rootId];
  if (!root) throw new Error(`toNewick: node "${rootId}" is not in the tree`);

  const labelOf = (n: TreeNode): string => {
    const l = label(n);
    return l === null ? '' : quoteNewickLabel(l);
  };
  const childrenOf = (n: TreeNode): string => {
    if (n.isLeaf) return '';
    const kids = childrenIndex.get(n.id) ?? [];
    const ordered = swapped !== undefined && swapped.has(n.id) ? [...kids].reverse() : kids;
    const parts: string[] = [];
    for (const k of ordered) {
      const child = tree.nodes[k];
      if (child) parts.push(visit(child));
    }
    return parts.length > 0 ? `(${parts.join(',')})` : '';
  };
  const visit = (n: TreeNode): string => {
    const len = branchLengths ? `:${n.distance.toFixed(precision)}` : '';
    return `${childrenOf(n)}${labelOf(n)}${len}`;
  };
  return `${childrenOf(root)}${labelOf(root)};`;
}
