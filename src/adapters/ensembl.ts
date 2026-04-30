import type {
  GeneId,
  GeneMetadata,
  MSA,
  NodeId,
  ProteinDomain,
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
    /** Genetree responses with sequence=protein expose the translation
     *  (ENSP) accession here. The shape varies — sometimes a string,
     *  sometimes a single object, sometimes an array of {accession,
     *  source}. extractProteinId() handles all three. */
    id?:
      | string
      | { accession?: string; source?: string }
      | ReadonlyArray<{ accession?: string; source?: string }>;
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
  /**
   * GeneId → translation (ENSP) accession, when the gene-tree response
   * carried it. Hosts use this to fan out to
   * `/overlap/translation/{ENSP}?feature=protein_feature` and feed the
   * results into `fromEnsemblProteinFeatures`. Missing entries simply
   * mean we couldn't resolve a protein id for that leaf — skip those.
   */
  proteinIdByGeneId: Record<GeneId, string>;
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
  const proteinIdByGeneId: Record<GeneId, string> = {};
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
        const proteinId = extractProteinId(en.sequence);
        if (proteinId) proteinIdByGeneId[accession] = proteinId;
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

  return { tree: { rootId, nodes }, taxonomy, msa, geneMetadata, proteinIdByGeneId };
}

/**
 * Resolve the translation (ENSP) accession from a genetree leaf's
 * `sequence` block. The Ensembl shape varies — `sequence.id` can be a
 * string, an object, or an array of {accession, source} entries (with
 * Ensembl's own assignment usually being the one we want). When all of
 * those are absent, fall back to `sequence.name` if it looks like an
 * Ensembl protein accession.
 */
function extractProteinId(seq: EnsemblNode['sequence']): string | null {
  if (!seq) return null;
  const sid: unknown = seq.id;
  if (Array.isArray(sid)) {
    type Entry = { accession?: string; source?: string };
    const arr = sid as ReadonlyArray<Entry>;
    const ensembl = arr.find(
      (e) =>
        e &&
        typeof e === 'object' &&
        typeof e.accession === 'string' &&
        (e.source ?? '').toLowerCase().includes('ensembl'),
    );
    const pick = ensembl ?? arr.find((e) => e && typeof e.accession === 'string');
    if (pick?.accession) return pick.accession;
  } else if (typeof sid === 'string' && sid !== '') {
    return sid;
  } else if (sid && typeof sid === 'object') {
    const obj = sid as { accession?: string };
    if (typeof obj.accession === 'string' && obj.accession !== '') return obj.accession;
  }
  if (typeof seq.name === 'string' && /^ENS\w*P\d+/i.test(seq.name)) return seq.name;
  return null;
}

// ─── Protein-feature (domain) endpoint ────────────────────────────────────────

export interface FromEnsemblProteinFeaturesOptions {
  /**
   * Restrict to specific feature sources (Ensembl's `type` field —
   * case-sensitive: `"Pfam"`, `"Smart"`, `"SuperFamily"`, `"PANTHER"`,
   * `"Gene3D"`, `"Prints"`, `"PIRSF"`, `"Tmhmm"`, `"Signalp"`, ...).
   * Pass `undefined` or an empty list to keep every source.
   */
  sources?: ReadonlyArray<string>;
}

interface EnsemblProteinFeatureRow {
  id?: string;
  description?: string;
  type?: string;
  start?: number;
  end?: number;
  interpro?: string;
}

/**
 * Convert an Ensembl `/overlap/translation/{ENSP}?feature=protein_feature`
 * response into TBrowse's ProteinDomain[] for that single protein. Pure;
 * the caller does the network fetch and assembles the per-GeneId dict.
 *
 * Rows missing required fields (`id`, numeric `start`/`end`) are skipped
 * silently — Ensembl occasionally returns sparse hits that aren't useful.
 *
 * Docs: https://rest.ensembl.org/documentation/info/overlap_translation
 */
export function fromEnsemblProteinFeatures(
  json: unknown,
  options: FromEnsemblProteinFeaturesOptions = {},
): ProteinDomain[] {
  if (!Array.isArray(json)) {
    throw new Error(
      'fromEnsemblProteinFeatures: expected an array of protein-feature rows',
    );
  }
  const allow =
    options.sources && options.sources.length > 0
      ? new Set(options.sources)
      : null;
  const out: ProteinDomain[] = [];
  for (const raw of json as EnsemblProteinFeatureRow[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.id !== 'string' || raw.id === '') continue;
    if (typeof raw.start !== 'number' || typeof raw.end !== 'number') continue;
    if (allow && !allow.has(raw.type ?? '')) continue;
    const domain: ProteinDomain = {
      id: raw.id,
      name: raw.description ?? raw.id,
      start: raw.start,
      end: raw.end,
    };
    if (typeof raw.type === 'string' && raw.type !== '') domain.source = raw.type;
    out.push(domain);
  }
  return out;
}

function detectAlphabet(sequences: string[]): MSA['alphabet'] {
  // Look at up to ~4000 chars across the first few sequences. If everything
  // outside gaps fits the DNA alphabet, call it DNA; otherwise protein.
  const sample = sequences.slice(0, 5).join('').slice(0, 4000);
  return /^[ACGTNacgtn\-]*$/.test(sample) ? 'dna' : 'protein';
}
