import type { GeneId, NodeId, Taxonomy, TaxonomyId, TaxonomyNode, Tree, TreeNode } from '../types';

/**
 * How to read a nested (hierarchical) node type `N` when flattening it into
 * a `Tree`. Only `id` and `children` are required; the rest are optional
 * decorations. `distance` defaults to 0 for the root and 1 otherwise (a
 * uniform cladogram, as a taxonomy carries no branch lengths).
 */
export interface HierarchyAccessors<N> {
  id: (n: N) => string | number;
  children: (n: N) => readonly N[] | undefined;
  distance?: (n: N, parent: N | null) => number;
  taxonomyId?: (n: N) => TaxonomyId | undefined;
  geneId?: (n: N) => GeneId | undefined;
  /** Taxonomy entry to record under `String(taxonomyId(n))`. */
  taxon?: (n: N) => TaxonomyNode | undefined;
}

/** Result of flattening a hierarchy. `leafIds` are in pre-order (display) order. */
export interface FromHierarchyResult {
  tree: Tree;
  taxonomy: Taxonomy;
  leafIds: NodeId[];
  warnings: string[];
}

/**
 * Flatten a nested node structure into a tbrowse `Tree` (+ `Taxonomy`) by
 * a pre-order walk. Node ids are `String(acc.id(n))`; a node whose id was
 * already seen is skipped together with its subtree (and reported in
 * `warnings`), so a malformed, cyclic or duplicate-id hierarchy cannot spin
 * the walk. A node is a leaf when it has no children.
 * Origin: gramene-search `taxTree/toTbrowseTree.js:23-62` (the `walk`),
 * generalised over accessor functions.
 */
export function fromHierarchy<N>(root: N, acc: HierarchyAccessors<N>): FromHierarchyResult {
  const nodes: Record<NodeId, TreeNode> = {};
  const taxonomy: Taxonomy = {};
  const leafIds: NodeId[] = [];
  const warnings: string[] = [];
  const rootId = String(acc.id(root));

  // Iterative pre-order; children are pushed in reverse so they pop in order.
  const stack: Array<{ node: N; parent: N | null; parentId: NodeId | null }> = [
    { node: root, parent: null, parentId: null },
  ];
  while (stack.length > 0) {
    const { node, parent, parentId } = stack.pop()!;
    const id = String(acc.id(node));
    // Guard against the (shouldn't-happen) cyclic / duplicate id case.
    if (nodes[id]) {
      warnings.push(`duplicate node id "${id}" skipped`);
      continue;
    }
    const kids = acc.children(node) ?? [];
    const isLeaf = kids.length === 0;
    const distance = acc.distance ? acc.distance(node, parent) : parentId === null ? 0 : 1;
    const taxonomyId = acc.taxonomyId?.(node);
    const geneId = acc.geneId?.(node);
    nodes[id] = {
      id,
      parentId,
      distance,
      isLeaf,
      ...(taxonomyId !== undefined ? { taxonomyId } : {}),
      ...(geneId !== undefined ? { geneId } : {}),
    };
    const taxon = acc.taxon?.(node);
    if (taxon !== undefined) {
      if (taxonomyId !== undefined) taxonomy[String(taxonomyId)] = taxon;
      else warnings.push(`node "${id}" has a taxon entry but no taxonomyId; entry dropped`);
    }
    if (isLeaf) leafIds.push(id);
    for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i]!, parent: node, parentId: id });
  }

  return { tree: { rootId, nodes }, taxonomy, leafIds, warnings };
}

/**
 * The shape of a gramene `taxonomy-with-genomes` tree node (and of any
 * `tree-model` node): `model.id` is the NCBI taxon id, `model.name` the
 * display name, `model.rank` the rank; `children` the subclades.
 */
export interface TreeModelLike {
  model: { id: string | number; name?: string; rank?: string };
  children?: TreeModelLike[];
}

/**
 * gramene-search's taxonomy-tree adapter: node id = `String(model.id)`,
 * `distance` 0 for the root and `opts.distance` (default 1) otherwise,
 * `taxonomyId` = the id (a string by default; `taxonomyIdAs: 'number'`
 * emits `Number(model.id)`), and a `Taxonomy` entry per node exposing
 * `model.name` as both `scientificName` and `commonName` (so the labels zone
 * shows something whichever field is active) plus `rank`. `leafTaxonIds` are
 * the leaf ids in pre-order, as the TaxDist view consumes them.
 * Origin: gramene-search `taxTree/toTbrowseTree.js:23-62` (`toTbrowseTree`).
 */
export function fromTreeModel(
  root: TreeModelLike,
  opts: { distance?: number; taxonomyIdAs?: 'string' | 'number' } = {},
): FromHierarchyResult & { leafTaxonIds: string[] } {
  if (!root || !root.model) throw new Error('fromTreeModel: root has no model');
  const distance = opts.distance ?? 1;
  const asNumber = opts.taxonomyIdAs === 'number';
  const result = fromHierarchy<TreeModelLike>(root, {
    id: (n) => n.model.id,
    // The original walk returned early on a child without a `model`; filter those out.
    children: (n) => n.children?.filter((k) => k && k.model),
    distance: (_n, parent) => (parent === null ? 0 : distance),
    taxonomyId: (n) => (asNumber ? Number(n.model.id) : String(n.model.id)),
    taxon: (n) => {
      const name = n.model.name;
      const rank = n.model.rank;
      return {
        ...(name !== undefined ? { scientificName: name, commonName: name } : {}),
        ...(rank !== undefined ? { rank } : {}),
      };
    },
  });
  return { ...result, leafTaxonIds: result.leafIds };
}
