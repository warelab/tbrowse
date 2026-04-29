import type { Taxonomy, Tree, TreeNode } from 'tbrowse';

export const sampleTree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0,    isLeaf: false, taxonomyId: 7742, eventType: 'speciation' },
    n1: { id: 'n1', parentId: 'n0', distance: 0.04, isLeaf: false, taxonomyId: 9347, eventType: 'speciation', bootstrap: 92 },
    n2: { id: 'n2', parentId: 'n0', distance: 0.05, isLeaf: true,  taxonomyId: 7955, geneId: 'ENSDARG00000001' },
    n3: { id: 'n3', parentId: 'n1', distance: 0.02, isLeaf: false, taxonomyId: 9443, eventType: 'duplication', bootstrap: 70 },
    n4: { id: 'n4', parentId: 'n3', distance: 0.01, isLeaf: true,  taxonomyId: 9606, geneId: 'ENSG00000000001' },
    n5: { id: 'n5', parentId: 'n3', distance: 0.01, isLeaf: true,  taxonomyId: 9598, geneId: 'ENSPTRG00000001' },
    n6: { id: 'n6', parentId: 'n1', distance: 0.03, isLeaf: true,  taxonomyId: 10090, geneId: 'ENSMUSG00000001' },
    n7: { id: 'n7', parentId: 'n1', distance: 0.03, isLeaf: true,  taxonomyId: 10116, geneId: 'ENSRNOG00000001' },
  },
};

export const sampleTaxonomy: Taxonomy = {
  7742:  { scientificName: 'Vertebrata', commonName: 'Vertebrates' },
  7955:  { scientificName: 'Danio rerio', commonName: 'Zebrafish' },
  9347:  { scientificName: 'Eutheria', commonName: 'Placental mammals' },
  9443:  { scientificName: 'Primates', commonName: 'Primates' },
  9598:  { scientificName: 'Pan troglodytes', commonName: 'Chimpanzee' },
  9606:  { scientificName: 'Homo sapiens', commonName: 'Human' },
  10090: { scientificName: 'Mus musculus', commonName: 'Mouse' },
  10116: { scientificName: 'Rattus norvegicus', commonName: 'Rat' },
};

// Synthetic balanced binary tree with `leafCount` leaves, for exercising virtualization.
export const largeSampleTree: Tree = (() => {
  const leafCount = 1024;
  const nodes: Record<string, TreeNode> = {};
  let nextId = 0;
  const make = (depth: number, parentId: string | null): string => {
    const id = `m${nextId++}`;
    if (depth === 0) {
      nodes[id] = { id, parentId, distance: 0.05, isLeaf: true, geneId: `GENE${id}` };
      return id;
    }
    nodes[id] = { id, parentId, distance: 0.05, isLeaf: false, eventType: 'speciation' };
    make(depth - 1, id);
    make(depth - 1, id);
    return id;
  };
  const rootId = make(Math.log2(leafCount), null);
  return { rootId, nodes };
})();
