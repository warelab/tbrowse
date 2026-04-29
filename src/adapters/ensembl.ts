import type {
  GeneMetadata,
  MSA,
  NodeId,
  Taxonomy,
  Tree,
  TreeNode,
} from '../types';

/**
 * Subset of the Ensembl gene-tree JSON shape that we consume.
 * https://rest.ensembl.org/documentation/info/genetree
 */
interface EnsemblNode {
  branch_length?: number;
  confidence?: { bootstrap?: number };
  events?: { type?: string };
  taxonomy?: {
    id?: number;
    scientific_name?: string;
    common_name?: string;
    timetree_mya?: number;
  };
  id?: { accession?: string; source?: string };
  sequence?: {
    mol_seq?: { is_aligned?: number | boolean; seq?: string };
    name?: string;
  };
  children?: EnsemblNode[];
}

interface EnsemblResponse {
  type?: string;
  tree?: EnsemblNode;
  id?: string;
  rooted?: number | boolean;
}

export interface FromEnsemblOptions {
  /**
   * Override the MSA alphabet. When omitted, alphabet is sniffed from the
   * sequence contents (DNA if every character matches /[ACGTN-]/i,
   * protein otherwise). Pass explicitly when you fetched cdna or are
   * working with non-standard residue characters.
   */
  alphabet?: MSA['alphabet'];
}

export interface FromEnsemblResult {
  tree: Tree;
  taxonomy: Taxonomy;
  msa?: MSA;
  geneMetadata: GeneMetadata;
}

/**
 * Convert an Ensembl gene-tree REST response into TBrowse's normalized inputs.
 *
 * Synthetic node IDs are assigned in pre-order ("n0", "n1", ...) so they are
 * deterministic across runs against the same response — important for URL
 * state round-tripping.
 *
 * Pass options.alphabet explicitly if you fetched the tree with sequence=cdna
 * (otherwise the heuristic infers protein for any non-DNA character).
 */
export function fromEnsemblGeneTree(
  json: unknown,
  options: FromEnsemblOptions = {},
): FromEnsemblResult {
  const response = json as EnsemblResponse;
  if (!response || !response.tree) {
    throw new Error(
      'fromEnsemblGeneTree: input is not a valid Ensembl gene-tree response (missing top-level "tree")',
    );
  }

  const nodes: Record<NodeId, TreeNode> = {};
  const taxonomy: Taxonomy = {};
  const sequences: Record<string, string> = {};
  const geneMetadata: GeneMetadata = {};
  let nextId = 0;

  const walk = (en: EnsemblNode, parentId: NodeId | null): NodeId => {
    const id: NodeId = `n${nextId++}`;
    const isLeaf = !en.children || en.children.length === 0;

    const node: TreeNode = {
      id,
      parentId,
      distance: typeof en.branch_length === 'number' ? en.branch_length : 0,
      isLeaf,
    };

    if (en.taxonomy?.id !== undefined) {
      node.taxonomyId = en.taxonomy.id;
      if (!taxonomy[en.taxonomy.id]) {
        const tax: Taxonomy[number] = {};
        if (en.taxonomy.scientific_name) tax.scientificName = en.taxonomy.scientific_name;
        if (en.taxonomy.common_name) tax.commonName = en.taxonomy.common_name;
        taxonomy[en.taxonomy.id] = tax;
      }
    }

    if (en.events?.type === 'speciation' || en.events?.type === 'duplication') {
      node.eventType = en.events.type;
    }

    if (en.confidence && typeof en.confidence.bootstrap === 'number') {
      node.bootstrap = en.confidence.bootstrap;
    }

    if (isLeaf) {
      const accession = en.id?.accession;
      if (accession) {
        node.geneId = accession;
        if (en.sequence?.mol_seq?.seq) {
          sequences[accession] = en.sequence.mol_seq.seq;
        }
        const meta: Record<string, unknown> = {};
        if (en.sequence?.name) meta.displayName = en.sequence.name;
        if (Object.keys(meta).length > 0) geneMetadata[accession] = meta;
      }
    }

    nodes[id] = node;

    if (en.children) {
      for (const child of en.children) walk(child, id);
    }

    return id;
  };

  const rootId = walk(response.tree, null);

  const sequenceList = Object.values(sequences);
  let msa: MSA | undefined;
  if (sequenceList.length > 0) {
    const length = sequenceList.reduce((m, s) => Math.max(m, s.length), 0);
    // Pad short sequences with gap characters so all rows align.
    for (const k of Object.keys(sequences)) {
      if (sequences[k].length < length) sequences[k] = sequences[k].padEnd(length, '-');
    }
    const alphabet = options.alphabet ?? detectAlphabet(sequenceList);
    msa = { alphabet, length, sequences };
  }

  return { tree: { rootId, nodes }, taxonomy, msa, geneMetadata };
}

function detectAlphabet(sequences: string[]): MSA['alphabet'] {
  // Look at up to ~4000 chars across the first few sequences. If everything
  // outside gaps fits the DNA alphabet, call it DNA; otherwise protein.
  const sample = sequences.slice(0, 5).join('').slice(0, 4000);
  return /^[ACGTNacgtn\-]*$/.test(sample) ? 'dna' : 'protein';
}
