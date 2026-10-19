/**
 * Hand-made gene-tree fixture in the shape gramene-search's Homology view
 * hands tbrowse: leaves carry a `geneId` and a numeric `taxonomyId`, with
 * several genes per species so maximal-clade pruning has clades to find.
 *
 *   n0
 *   ├── n1
 *   │   ├── g1  SORBI_1   taxon 4558  (sorghum)
 *   │   └── g2  ZM_1      taxon 4577  (maize)
 *   ├── n2
 *   │   ├── n3
 *   │   │   ├── g3  OS_1  taxon 39947 (rice)
 *   │   │   └── g4  OS_2  taxon 39947 (rice)
 *   │   └── g5  ZM_2      taxon 4577  (maize)
 *   └── g6  AT_1          taxon 3702  (arabidopsis)
 */
import type { Tree } from '../../../src/types';

export const geneTree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 0.2, isLeaf: false },
    g1: { id: 'g1', parentId: 'n1', distance: 0.3, isLeaf: true, geneId: 'SORBI_1', taxonomyId: 4558 },
    g2: { id: 'g2', parentId: 'n1', distance: 0.35, isLeaf: true, geneId: 'ZM_1', taxonomyId: 4577 },
    n2: { id: 'n2', parentId: 'n0', distance: 0.1, isLeaf: false },
    n3: { id: 'n3', parentId: 'n2', distance: 0.25, isLeaf: false },
    g3: { id: 'g3', parentId: 'n3', distance: 0.05, isLeaf: true, geneId: 'OS_1', taxonomyId: 39947 },
    g4: { id: 'g4', parentId: 'n3', distance: 0.06, isLeaf: true, geneId: 'OS_2', taxonomyId: 39947 },
    g5: { id: 'g5', parentId: 'n2', distance: 0.4, isLeaf: true, geneId: 'ZM_2', taxonomyId: 4577 },
    g6: { id: 'g6', parentId: 'n0', distance: 0.9, isLeaf: true, geneId: 'AT_1', taxonomyId: 3702 },
  },
};
