import type {
  GeneMetadata,
  GeneStructure,
  GenomeFeature,
  LabelProvider,
  MSA,
  ProteinDomain,
  TableColumn,
  TableData,
  Taxonomy,
  Tree,
  TreeNode,
} from 'tbrowse';

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

// Hand-crafted protein domain hits, in 1-based UNALIGNED residue
// coordinates. Real Pfam hits would come from InterPro / Ensembl;
// these mimic the p53 transactivation + DNA-binding regions across
// the family, with the human/chimp pair perfectly conserved and the
// non-mammalian leaves missing one of the hits.
export const sampleProteinDomains: Record<string, ProteinDomain[]> = {
  ENSG00000000001: [
    { id: 'PF08563', name: 'p53 transactivation', start: 6, end: 30, source: 'Pfam' },
    { id: 'PF00870', name: 'p53 DNA-binding domain', start: 35, end: 58, source: 'Pfam' },
  ],
  ENSPTRG00000001: [
    { id: 'PF08563', name: 'p53 transactivation', start: 6, end: 30, source: 'Pfam' },
    { id: 'PF00870', name: 'p53 DNA-binding domain', start: 35, end: 58, source: 'Pfam' },
  ],
  ENSMUSG00000001: [
    { id: 'PF08563', name: 'p53 transactivation', start: 9, end: 32, source: 'Pfam' },
    { id: 'PF00870', name: 'p53 DNA-binding domain', start: 38, end: 58, source: 'Pfam' },
  ],
  ENSRNOG00000001: [
    { id: 'PF08563', name: 'p53 transactivation', start: 4, end: 28, source: 'Pfam' },
    { id: 'PF00870', name: 'p53 DNA-binding domain', start: 33, end: 56, source: 'Pfam' },
  ],
  ENSDARG00000001: [
    // Zebrafish loses the C-terminal DNA-binding hit (sample MSA truncates
    // here) — useful for visually checking the per-leaf layout.
    { id: 'PF08563', name: 'p53 transactivation', start: 5, end: 29, source: 'Pfam' },
  ],
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

// ---------- Sample tabular data zone ----------
//
// Two example user-uploaded tables with arbitrary columns. Genes
// without entries render as null cells. The playground passes these
// to `createTableZone` to produce one zone definition per table.

export const sampleExpressionColumns: TableColumn[] = [
  { id: 'tissue', label: 'Tissue', kind: 'string', width: 90 },
  { id: 'tpm', label: 'TPM', kind: 'number', width: 80, display: 'heatmap' },
  { id: 'logfc', label: 'log2 FC', kind: 'number', width: 80, display: 'heatmap' },
  { id: 'sig', label: 'Sig.', kind: 'boolean', width: 50 },
  { id: 'note', label: 'Note', kind: 'string', width: 160, searchable: true },
];

export const sampleExpressionTable: TableData = {
  ENSG00000000001: { tissue: 'Liver', tpm: 142.5, logfc: 2.31, sig: true, note: 'Up in tumor' },
  ENSPTRG00000001: { tissue: 'Liver', tpm: 130.2, logfc: 2.15, sig: true, note: 'Up in tumor' },
  ENSMUSG00000001: { tissue: 'Liver', tpm: 88.7, logfc: 0.42, sig: false, note: null },
  ENSDARG00000001: { tissue: 'Embryo', tpm: 12.4, logfc: -0.18, sig: false },
  // ENSRNOG00000001 intentionally omitted to show null-row behaviour.
};

export const sampleScoreColumns: TableColumn[] = [
  { id: 'orth', label: 'Orth. score', kind: 'number', width: 90 },
  { id: 'paralogs', label: '# paralogs', kind: 'number', width: 90 },
  { id: 'curated', label: 'Curated', kind: 'boolean', width: 70 },
];

export const sampleScoreTable: TableData = {
  ENSG00000000001: { orth: 0.97, paralogs: 2, curated: true },
  ENSPTRG00000001: { orth: 0.94, paralogs: 2, curated: true },
  ENSMUSG00000001: { orth: 0.81, paralogs: 1, curated: false },
  ENSRNOG00000001: { orth: 0.78, paralogs: 1, curated: false },
  ENSDARG00000001: { orth: 0.42, paralogs: 3, curated: false },
};

// Hand-crafted gene structures for the five sample leaves. Each gene has
// 4 exons covering a 60-residue protein (60×3 = 180 nt CDS) plus 5'UTR
// and 3'UTR, with one or two long introns to exercise the // compression
// glyph. Two leaves sit on the reverse strand to exercise auto-flipping.
export const sampleGeneStructures: Record<string, GeneStructure> = {
  ENSG00000000001: {
    region: '17',
    strand: 1,
    start: 1000,
    end: 8200,
    canonicalTranscriptId: 'ENST_HUMAN_TP53.1',
    name: 'TP53',
    transcripts: [
      {
        id: 'ENST_HUMAN_TP53.1',
        isCanonical: true,
        biotype: 'protein_coding',
        exons: [
          { start: 1000, end: 1199, cdsStart: 1100, cdsEnd: 1199 }, // 5'UTR + 100 cds nt
          { start: 3000, end: 3049, cdsStart: 3000, cdsEnd: 3049 }, // 50 cds nt
          { start: 6000, end: 6029, cdsStart: 6000, cdsEnd: 6029 }, // 30 cds nt
          { start: 8000, end: 8200, cdsStart: 8000, cdsEnd: 8002 }, // 3 cds (stop) + 3'UTR
        ],
      },
      {
        id: 'ENST_HUMAN_TP53.2',
        biotype: 'protein_coding',
        exons: [
          { start: 1000, end: 1199, cdsStart: 1100, cdsEnd: 1199 },
          { start: 6000, end: 6029, cdsStart: 6000, cdsEnd: 6029 },
          { start: 8000, end: 8200, cdsStart: 8000, cdsEnd: 8002 },
        ],
      },
    ],
  },
  ENSPTRG00000001: {
    region: '17',
    strand: 1,
    start: 1000,
    end: 8200,
    canonicalTranscriptId: 'ENSPTRT_TP53.1',
    name: 'TP53',
    transcripts: [
      {
        id: 'ENSPTRT_TP53.1',
        isCanonical: true,
        biotype: 'protein_coding',
        exons: [
          { start: 1000, end: 1199, cdsStart: 1100, cdsEnd: 1199 },
          { start: 3000, end: 3049, cdsStart: 3000, cdsEnd: 3049 },
          { start: 6000, end: 6029, cdsStart: 6000, cdsEnd: 6029 },
          { start: 8000, end: 8200, cdsStart: 8000, cdsEnd: 8002 },
        ],
      },
    ],
  },
  ENSMUSG00000001: {
    // Reverse strand to exercise auto-flip.
    region: '11',
    strand: -1,
    start: 1000,
    end: 7900,
    canonicalTranscriptId: 'ENSMUST_Trp53.1',
    name: 'Trp53',
    transcripts: [
      {
        id: 'ENSMUST_Trp53.1',
        isCanonical: true,
        biotype: 'protein_coding',
        exons: [
          { start: 1000, end: 1300, cdsStart: 1003, cdsEnd: 1300 },   // stop + 3'UTR (low end on - strand)
          { start: 4000, end: 4019, cdsStart: 4000, cdsEnd: 4019 },
          { start: 7000, end: 7150, cdsStart: 7000, cdsEnd: 7150 },
          { start: 7800, end: 7900, cdsStart: 7800, cdsEnd: 7849 },   // 5'UTR (high end on - strand)
        ],
      },
    ],
  },
  ENSRNOG00000001: {
    region: '10',
    strand: -1,
    start: 500,
    end: 6000,
    canonicalTranscriptId: 'ENSRNOT_Tp53.1',
    name: 'Tp53',
    transcripts: [
      {
        id: 'ENSRNOT_Tp53.1',
        isCanonical: true,
        biotype: 'protein_coding',
        exons: [
          { start: 500, end: 700, cdsStart: 503, cdsEnd: 700 },
          { start: 2500, end: 2519, cdsStart: 2500, cdsEnd: 2519 },
          { start: 5000, end: 5151, cdsStart: 5000, cdsEnd: 5151 },
          { start: 5900, end: 6000, cdsStart: 5900, cdsEnd: 5959 },
        ],
      },
    ],
  },
  ENSDARG00000001: {
    region: '5',
    strand: 1,
    start: 200,
    end: 5500,
    canonicalTranscriptId: 'ENSDART_tp53.1',
    name: 'tp53',
    transcripts: [
      {
        id: 'ENSDART_tp53.1',
        isCanonical: true,
        biotype: 'protein_coding',
        exons: [
          { start: 200, end: 320, cdsStart: 261, cdsEnd: 320 },   // 5'UTR + 60 cds nt
          { start: 2000, end: 2089, cdsStart: 2000, cdsEnd: 2089 }, // 90 cds nt
          { start: 4000, end: 4029, cdsStart: 4000, cdsEnd: 4029 }, // 30 cds nt
          { start: 5400, end: 5500, cdsStart: 5400, cdsEnd: 5402 }, // stop + 3'UTR
        ],
      },
    ],
  },
};

// Sample proximal genome features for a couple of leaves — TFBS clusters
// around the human and chimp TP53 promoters, plus a CpG island.
export const sampleGenomeFeatures: Record<string, GenomeFeature[]> = {
  ENSG00000000001: [
    { id: 'tfbs-1', kind: 'TFBS', start: 950, end: 970, label: 'SP1' },
    { id: 'tfbs-2', kind: 'TFBS', start: 1020, end: 1035, label: 'NF-Y' },
    { id: 'cpg-1', kind: 'CpG', start: 980, end: 1080, label: 'CpG island' },
  ],
  ENSPTRG00000001: [
    { id: 'tfbs-1', kind: 'TFBS', start: 950, end: 970, label: 'SP1' },
    { id: 'tfbs-2', kind: 'TFBS', start: 1020, end: 1035, label: 'NF-Y' },
  ],
};
