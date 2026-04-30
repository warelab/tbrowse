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
 * Subset of the Gramene `/genetrees` JSON shape that we consume.
 * https://data.gramene.org/v69/genetrees?idList=...
 *
 * Internal nodes carry: node_id, distance_to_parent, taxon_id/name,
 * node_type ("speciation"|"duplication"|...), bootstrap, children.
 *
 * Leaves additionally carry: gene_stable_id, protein_stable_id, taxon_id,
 * taxon_name, system_name, sequence (UNALIGNED protein), cigar (run-length
 * gap encoding used to derive the aligned row), and domains[] (per-leaf
 * InterPro hits with residue ranges).
 */
interface GrameneNode {
  node_id?: number;
  distance_to_parent?: number;
  taxon_id?: number;
  taxon_name?: string;
  bootstrap?: number;
  node_type?: string;
  children?: GrameneNode[];
  // Leaf-only fields
  system_name?: string;
  gene_stable_id?: string;
  protein_stable_id?: string;
  gene_description?: string;
  sequence?: string;
  cigar?: string;
  domains?: Array<GrameneLeafDomain>;
}

interface GrameneLeafDomain {
  /** InterPro accession, e.g. "IPR001650". */
  id?: string;
  /** Numeric InterPro id (matches the domains endpoint's `_id`). */
  root?: number;
  start?: number;
  end?: number;
  name?: string;
  description?: string;
}

export interface FromGrameneGenetreeOptions {
  /**
   * Override the MSA alphabet. Defaults to 'protein' (Gramene gene-tree
   * leaves carry protein sequences).
   */
  alphabet?: MSA['alphabet'];
}

export interface FromGrameneGenetreeResult {
  tree: Tree;
  taxonomy: Taxonomy;
  msa?: MSA;
  geneMetadata: GeneMetadata;
  /** Per-leaf protein-domain hits, ready to drop into HostData.proteinDomains. */
  proteinDomains: Record<GeneId, ProteinDomain[]>;
  /** GeneId → translation accession (for parity with the Ensembl adapter). */
  proteinIdByGeneId: Record<GeneId, string>;
}

/**
 * Convert a Gramene `/genetrees?idList=...` response (an array containing
 * a single root node) into TBrowse's normalized inputs. Pure — host owns
 * the network call.
 *
 * Synthetic node ids (`n0`, `n1`, ...) are assigned in preorder so they
 * round-trip stably through URL state.
 */
export function fromGrameneGenetree(
  json: unknown,
  options: FromGrameneGenetreeOptions = {},
): FromGrameneGenetreeResult {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(
      'fromGrameneGenetree: expected a non-empty array of genetree root nodes',
    );
  }
  const root = json[0] as GrameneNode;

  const nodes: Record<NodeId, TreeNode> = {};
  const taxonomy: Taxonomy = {};
  const sequences: Record<string, string> = {};
  const geneMetadata: GeneMetadata = {};
  const proteinDomains: Record<GeneId, ProteinDomain[]> = {};
  const proteinIdByGeneId: Record<GeneId, string> = {};
  let nextId = 0;

  const walk = (gn: GrameneNode, parentId: NodeId | null): NodeId => {
    const id: NodeId = `n${nextId++}`;
    const isLeaf = !gn.children || gn.children.length === 0;

    const node: TreeNode = {
      id,
      parentId,
      distance: typeof gn.distance_to_parent === 'number' ? gn.distance_to_parent : 0,
      isLeaf,
    };

    if (typeof gn.taxon_id === 'number') {
      node.taxonomyId = gn.taxon_id;
      if (!taxonomy[gn.taxon_id]) {
        const tax: Taxonomy[number] = {};
        if (gn.taxon_name) tax.scientificName = gn.taxon_name;
        // Gramene exposes the lower-case slug as system_name on leaves;
        // surface it as commonName when present so the labels zone has
        // something friendly to render.
        if (isLeaf && gn.system_name) tax.commonName = gn.system_name;
        taxonomy[gn.taxon_id] = tax;
      }
    }

    if (gn.node_type === 'speciation' || gn.node_type === 'duplication') {
      node.eventType = gn.node_type;
    }
    if (typeof gn.bootstrap === 'number') node.bootstrap = gn.bootstrap;

    if (isLeaf) {
      const accession = gn.gene_stable_id;
      if (accession) {
        node.geneId = accession;
        // Aligned protein row: expand `cigar` against the unaligned
        // `sequence` so all leaves share a common MSA length.
        if (gn.sequence) {
          const aligned = gn.cigar ? expandCigar(gn.sequence, gn.cigar) : gn.sequence;
          sequences[accession] = aligned;
        }
        const meta: Record<string, unknown> = {};
        if (gn.gene_description) meta.description = gn.gene_description;
        if (gn.protein_stable_id) meta.proteinId = gn.protein_stable_id;
        if (Object.keys(meta).length > 0) geneMetadata[accession] = meta;
        if (gn.protein_stable_id) proteinIdByGeneId[accession] = gn.protein_stable_id;
        if (gn.domains && gn.domains.length > 0) {
          const hits: ProteinDomain[] = [];
          for (const d of gn.domains) {
            if (typeof d.id !== 'string' || d.id === '') continue;
            if (typeof d.start !== 'number' || typeof d.end !== 'number') continue;
            hits.push({
              id: d.id,
              name: d.name ?? d.description ?? d.id,
              start: d.start,
              end: d.end,
              source: 'InterPro',
            });
          }
          if (hits.length > 0) proteinDomains[accession] = hits;
        }
      }
    }

    nodes[id] = node;

    if (gn.children) {
      for (const child of gn.children) walk(child, id);
    }
    return id;
  };

  const rootId = walk(root, null);

  const sequenceList = Object.values(sequences);
  let msa: MSA | undefined;
  if (sequenceList.length > 0) {
    // After CIGAR expansion all rows should match in length, but pad the
    // odd short row defensively so the MSA invariant holds.
    const length = sequenceList.reduce((m, s) => Math.max(m, s.length), 0);
    for (const k of Object.keys(sequences)) {
      if (sequences[k].length < length) sequences[k] = sequences[k].padEnd(length, '-');
    }
    msa = { alphabet: options.alphabet ?? 'protein', length, sequences };
  }

  return {
    tree: { rootId, nodes },
    taxonomy,
    msa,
    geneMetadata,
    proteinDomains,
    proteinIdByGeneId,
  };
}

/**
 * Expand a Gramene CIGAR string against an unaligned protein sequence.
 *
 * The encoding here only uses `M` (consume <run> residues from the unaligned
 * sequence) and `D` (emit <run> gap characters). E.g. `expandCigar("MKLV", "2M1D2M")`
 * → `"MK-LV"`. Run length defaults to 1 when omitted (e.g. `"M1DM"`).
 *
 * Exported for testing.
 */
export function expandCigar(sequence: string, cigar: string): string {
  if (!cigar) return sequence;
  const out: string[] = [];
  let pos = 0;
  for (const match of cigar.matchAll(/(\d*)([MD])/g)) {
    const len = match[1] === '' ? 1 : parseInt(match[1], 10);
    if (match[2] === 'M') {
      out.push(sequence.substr(pos, len));
      pos += len;
    } else {
      out.push('-'.repeat(len));
    }
  }
  return out.join('');
}

// ─── Gene endpoint ────────────────────────────────────────────────────────────

interface GrameneGeneDoc {
  _id?: string;
  name?: string;
  description?: string;
  biotype?: string;
  taxon_id?: number;
  system_name?: string;
  homology?: { gene_tree?: { id?: string } };
}

export interface FromGrameneGeneResult {
  geneId: GeneId;
  geneTreeId: string | null;
  taxonomyId: number | null;
  systemName: string | null;
  description: string | null;
}

/**
 * Convert a Gramene `/genes?idList=<single-id>` response into the minimal
 * pieces a host needs to discover the gene's tree id and bootstrap a
 * tbrowse view. Returns `geneTreeId: null` when the gene has no tree
 * assignment so the caller can decide what to do (fall back to the gene
 * record alone, surface an error, etc.).
 */
export function fromGrameneGene(json: unknown): FromGrameneGeneResult {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('fromGrameneGene: expected a non-empty array of gene docs');
  }
  const doc = json[0] as GrameneGeneDoc;
  if (typeof doc._id !== 'string' || doc._id === '') {
    throw new Error('fromGrameneGene: gene doc is missing _id');
  }
  return {
    geneId: doc._id,
    geneTreeId: doc.homology?.gene_tree?.id ?? null,
    taxonomyId: typeof doc.taxon_id === 'number' ? doc.taxon_id : null,
    systemName: doc.system_name ?? null,
    description: doc.description ?? null,
  };
}
