import type {
  Exon,
  GeneId,
  GeneMetadata,
  GeneStructure,
  GenomeFeature,
  MSA,
  NodeId,
  ProteinDomain,
  Taxonomy,
  Transcript,
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

// ─── Ensembl /overlap/id endpoint ─────────────────────────────────────

/**
 * Subset of the Ensembl `/overlap/id/{id}` row shape we consume.
 * https://rest.ensembl.org/documentation/info/overlap_id
 *
 * The endpoint returns a single flat array containing every feature
 * that overlaps the requested id's genomic region — transcripts and
 * exons get filtered to those whose `Parent` matches the requested
 * gene; everything else (regulatory elements etc.) is consumed as a
 * `GenomeFeature`.
 */
interface EnsemblOverlapFeature {
  id?: string;
  feature_type?: string;
  Parent?: string;
  start?: number;
  end?: number;
  strand?: number;
  seq_region_name?: string;
  biotype?: string;
  is_canonical?: number;
  external_name?: string;
  description?: string;
  /** Regulatory- / motif-feature category (e.g. "Promoter",
   *  "CTCF Binding Site"). */
  feature_type_class?: string;
  /** Some feature types carry a `description` AND a `feature_type`
   *  string we want to surface in tooltips. We pick whichever is
   *  populated at conversion time. */
  binding_matrix_stable_id?: string;
}

/**
 * Convert one `/overlap/id/{geneId}?feature=transcript;feature=exon;feature=cds`
 * response into a `GeneStructure` for that gene. The caller passes the
 * gene's stable id so we can scope to its transcripts (the endpoint
 * returns features for every overlapping gene in the region).
 *
 * Returns `null` when the response carries no transcripts whose
 * `Parent === geneId` — i.e. the gene either doesn't exist or has no
 * structure on file. Soft-fails on partially-malformed rows: a row
 * missing required numerics is skipped rather than throwing.
 *
 * Pure: callers do the network fetch.
 *
 * Docs: https://rest.ensembl.org/documentation/info/overlap_id
 */
export function fromEnsemblGeneStructure(
  json: unknown,
  geneId: string,
): GeneStructure | null {
  if (!Array.isArray(json)) return null;
  const features = json as EnsemblOverlapFeature[];

  // Bucket by feature_type so the per-transcript walk runs in O(N).
  const transcripts: EnsemblOverlapFeature[] = [];
  const exonsByTranscript = new Map<string, EnsemblOverlapFeature[]>();
  const cdsByTranscript = new Map<string, EnsemblOverlapFeature[]>();
  for (const f of features) {
    if (!f || typeof f.feature_type !== 'string') continue;
    if (f.feature_type === 'transcript') {
      if (f.Parent === geneId) transcripts.push(f);
    } else if (f.feature_type === 'exon' && typeof f.Parent === 'string') {
      const arr = exonsByTranscript.get(f.Parent) ?? [];
      arr.push(f);
      exonsByTranscript.set(f.Parent, arr);
    } else if (f.feature_type === 'cds' && typeof f.Parent === 'string') {
      const arr = cdsByTranscript.get(f.Parent) ?? [];
      arr.push(f);
      cdsByTranscript.set(f.Parent, arr);
    }
  }
  if (transcripts.length === 0) return null;

  // Pick the first sensible transcript to read shared gene-level
  // metadata (region, strand). Ensembl always returns at least one
  // transcript with these fields populated.
  const ref = transcripts.find(
    (t) =>
      typeof t.seq_region_name === 'string' &&
      typeof t.strand === 'number',
  );
  if (
    !ref ||
    typeof ref.seq_region_name !== 'string' ||
    typeof ref.strand !== 'number'
  ) {
    return null;
  }
  const region = ref.seq_region_name;
  const strand: 1 | -1 = ref.strand === -1 ? -1 : 1;

  let geneStart = Infinity;
  let geneEnd = -Infinity;
  const transcriptsOut: Transcript[] = [];
  let canonicalId: string | null = null;
  // Single canonical-tag pass at the end — collect candidates here so
  // we can fall back deterministically when the endpoint omits the
  // flag (rare but possible on archived assemblies).
  for (const t of transcripts) {
    if (
      typeof t.id !== 'string' ||
      typeof t.start !== 'number' ||
      typeof t.end !== 'number'
    ) {
      continue;
    }
    if (t.start < geneStart) geneStart = t.start;
    if (t.end > geneEnd) geneEnd = t.end;
    const exonRows = (exonsByTranscript.get(t.id) ?? [])
      .filter(
        (e) => typeof e.start === 'number' && typeof e.end === 'number',
      )
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    const cdsRows = (cdsByTranscript.get(t.id) ?? []).filter(
      (c) => typeof c.start === 'number' && typeof c.end === 'number',
    );
    const exonsOut: Exon[] = [];
    for (const e of exonRows) {
      const eStart = e.start as number;
      const eEnd = e.end as number;
      let cdsStart: number | undefined;
      let cdsEnd: number | undefined;
      // CDS rows are returned per-exon-segment; find any whose interval
      // intersects this exon and intersect down to the exon's bounds.
      for (const c of cdsRows) {
        const cStart = c.start as number;
        const cEnd = c.end as number;
        if (cEnd < eStart || cStart > eEnd) continue;
        const sub = Math.max(cStart, eStart);
        const eub = Math.min(cEnd, eEnd);
        cdsStart = cdsStart === undefined ? sub : Math.min(cdsStart, sub);
        cdsEnd = cdsEnd === undefined ? eub : Math.max(cdsEnd, eub);
      }
      exonsOut.push({ start: eStart, end: eEnd, cdsStart, cdsEnd });
    }
    if (t.is_canonical === 1) canonicalId = t.id;
    transcriptsOut.push({
      id: t.id,
      isCanonical: t.is_canonical === 1,
      biotype: typeof t.biotype === 'string' ? t.biotype : undefined,
      exons: exonsOut,
    });
  }
  if (transcriptsOut.length === 0) return null;
  if (!canonicalId) {
    // No explicit `is_canonical` flag — pick the longest CDS, ties
    // broken by total exon length, deterministic across renders.
    let bestCds = -1;
    let bestLen = -1;
    let bestId = transcriptsOut[0].id;
    for (const tr of transcriptsOut) {
      let cds = 0;
      let len = 0;
      for (const e of tr.exons) {
        if (e.cdsStart !== undefined && e.cdsEnd !== undefined) {
          cds += e.cdsEnd - e.cdsStart + 1;
        }
        len += e.end - e.start + 1;
      }
      if (cds > bestCds || (cds === bestCds && len > bestLen)) {
        bestCds = cds;
        bestLen = len;
        bestId = tr.id;
      }
    }
    canonicalId = bestId;
    const found = transcriptsOut.find((tr) => tr.id === canonicalId);
    if (found) found.isCanonical = true;
  }

  const name =
    typeof ref.external_name === 'string' && ref.external_name !== ''
      ? // Ensembl appends "-201" etc. to transcript-level external_names;
        // strip that to surface the bare gene symbol.
        ref.external_name.replace(/-\d+$/, '')
      : undefined;

  return {
    region,
    strand,
    start: geneStart,
    end: geneEnd,
    canonicalTranscriptId: canonicalId,
    transcripts: transcriptsOut,
    name,
  };
}

/**
 * Convert one `/overlap/id/{geneId}?feature=regulatory;feature=motif`
 * response into the proximal-feature track that drives the genome
 * browser zone's optional annotations row.
 *
 * Each regulatory element / TF binding motif becomes one
 * `GenomeFeature`. The endpoint also surfaces `repeat`, `simple`,
 * etc. when those `feature=` flags are added; the converter accepts
 * them all and uses the row's `feature_type_class` (regulatory) or
 * `feature_type` as the kind label.
 */
export function fromEnsemblGenomeFeatures(json: unknown): GenomeFeature[] {
  if (!Array.isArray(json)) return [];
  const out: GenomeFeature[] = [];
  for (const raw of json as EnsemblOverlapFeature[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (
      typeof raw.id !== 'string' ||
      typeof raw.start !== 'number' ||
      typeof raw.end !== 'number'
    )
      continue;
    // Skip the gene-structure feature types — they're handled by
    // `fromEnsemblGeneStructure`. Anything else (regulatory, motif,
    // repeat, simple, mane, etc.) becomes a proximal feature.
    if (
      raw.feature_type === 'gene' ||
      raw.feature_type === 'transcript' ||
      raw.feature_type === 'exon' ||
      raw.feature_type === 'cds'
    )
      continue;
    const kind =
      (raw.feature_type_class && raw.feature_type_class !== '' &&
        raw.feature_type_class) ||
      raw.feature_type ||
      'feature';
    const f: GenomeFeature = {
      id: raw.id,
      kind,
      start: raw.start,
      end: raw.end,
    };
    if (raw.strand === 1 || raw.strand === -1) f.strand = raw.strand;
    const label =
      raw.description ??
      raw.binding_matrix_stable_id ??
      raw.feature_type_class ??
      raw.feature_type;
    if (typeof label === 'string' && label !== '') f.label = label;
    out.push(f);
  }
  return out;
}
