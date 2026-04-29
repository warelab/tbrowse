import type { GeneMetadata, LabelProvider, MSA, Taxonomy, Tree, TreeNode } from 'tbrowse';

export const sampleTree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0,     isLeaf: false, taxonomyId: 7742,  eventType: 'speciation' },
    n1: { id: 'n1', parentId: 'n0', distance: 0.04,  isLeaf: false, taxonomyId: 9347,  eventType: 'speciation', bootstrap: 92 },
    n2: { id: 'n2', parentId: 'n0', distance: 0.05,  isLeaf: true,  taxonomyId: 7955,  geneId: 'ENSDARG00000001' },
    n3: { id: 'n3', parentId: 'n1', distance: 0.02,  isLeaf: false, taxonomyId: 9443,  eventType: 'duplication', bootstrap: 70 },
    n4: { id: 'n4', parentId: 'n3', distance: 0.01,  isLeaf: true,  taxonomyId: 9606,  geneId: 'ENSG00000000001' },
    n5: { id: 'n5', parentId: 'n3', distance: 0.01,  isLeaf: true,  taxonomyId: 9598,  geneId: 'ENSPTRG00000001' },
    n8: { id: 'n8', parentId: 'n1', distance: 0.025, isLeaf: false, taxonomyId: 9989,  eventType: 'speciation', bootstrap: 88 },
    n6: { id: 'n6', parentId: 'n8', distance: 0.005, isLeaf: true,  taxonomyId: 10090, geneId: 'ENSMUSG00000001' },
    n7: { id: 'n7', parentId: 'n8', distance: 0.005, isLeaf: true,  taxonomyId: 10116, geneId: 'ENSRNOG00000001' },
  },
};

export const sampleGeneMetadata: GeneMetadata = {
  ENSDARG00000001: { displayName: 'tp53', description: 'tumor protein p53 (zebrafish)' },
  ENSG00000000001: { displayName: 'TP53', description: 'tumor protein p53 (human)' },
  ENSPTRG00000001: { displayName: 'TP53', description: 'tumor protein p53 (chimpanzee)' },
  ENSMUSG00000001: { displayName: 'Trp53', description: 'transformation related protein 53' },
  ENSRNOG00000001: { displayName: 'Tp53', description: 'tumor protein p53 (rat)' },
};

export const sampleTaxonomy: Taxonomy = {
  7742:  { scientificName: 'Vertebrata', commonName: 'Vertebrates' },
  7955:  { scientificName: 'Danio rerio', commonName: 'Zebrafish' },
  9347:  { scientificName: 'Eutheria', commonName: 'Placental mammals' },
  9443:  { scientificName: 'Primates', commonName: 'Primates' },
  9598:  { scientificName: 'Pan troglodytes', commonName: 'Chimpanzee' },
  9606:  { scientificName: 'Homo sapiens', commonName: 'Human' },
  9989:  { scientificName: 'Rodentia', commonName: 'Rodents' },
  10090: { scientificName: 'Mus musculus', commonName: 'Mouse' },
  10116: { scientificName: 'Rattus norvegicus', commonName: 'Rat' },
};

// Sample MSA: short hand-written protein alignment for the five sample genes.
// Real Ensembl alignments would be hundreds of columns; this is enough to
// exercise the canvas renderer at small scale.
export const sampleMSA: MSA = {
  alphabet: 'protein',
  length: 60,
  sequences: {
    ENSG00000000001:    'MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP',
    ENSPTRG00000001:    'MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGP',
    ENSMUSG00000001:    'MTAMEESQSDISLELPLSQETFSGLWKLLPPEDILPSPHCMDDLLLPQDVEEFFEGPSEA',
    ENSRNOG00000001:    'MEDSQSDMSI-ELPLSQETFSDLWKLLPPNNVLSTLPSSDSIEELFLPRSDIDQWLSEDR',
    ENSDARG00000001:    'MAQEPQSDLSIEPPLSQETFSELWNLLSPDSIPSSCSMHEALL------------ESVN',
  },
};

// Sample label provider that simulates an async fetch (~600ms latency).
// Demonstrates the LabelProvider plugin point: hosts register one of these
// with an arbitrary fetch and TBrowse surfaces it as a togglable Labels field.
export const sampleGoProvider: LabelProvider = {
  id: 'go-summary',
  label: 'GO summary',
  fetch: async (geneId: string, signal: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 600);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
    const annotations: Record<string, string> = {
      ENSDARG00000001: 'apoptosis, cell cycle',
      ENSG00000000001: 'apoptosis, DNA repair, cell cycle',
      ENSPTRG00000001: 'apoptosis, cell cycle, transcription',
      ENSMUSG00000001: 'apoptosis, cell cycle',
      ENSRNOG00000001: 'apoptosis, cell cycle',
    };
    return annotations[geneId] ?? null;
  },
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
