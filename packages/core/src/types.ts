/**
 * tbrowse-core data model.
 *
 * Everything the tbrowse viewer renders is described here, and nothing in
 * this file depends on React or the DOM. The viewer re-exports these types
 * unchanged, so `import type { Tree } from 'tbrowse'` and
 * `import type { Tree } from 'tbrowse-core'` name the same type.
 */

export type NodeId = string;
export type GeneId = string;
/**
 * Taxon identifier. Widened from `number` in tbrowse 2.11 / tbrowse-core 0.1: Gramene gene
 * trees carry numeric NCBI taxon ids while gramene-search's taxonomic
 * distribution view keys its species tree by `String(taxonId)`. Every
 * consumer only ever uses it as a `Taxonomy` key or in an equality test,
 * and a JS object is string-keyed at runtime anyway, so both spellings
 * index the same entry.
 */
export type TaxonomyId = string | number;

export interface TreeNode {
  id: NodeId;
  parentId: NodeId | null;
  distance: number;
  isLeaf: boolean;
  taxonomyId?: TaxonomyId;
  geneId?: GeneId;
  eventType?: 'speciation' | 'duplication';
  bootstrap?: number;
}

export interface Tree {
  rootId: NodeId;
  nodes: Record<NodeId, TreeNode>;
}

export interface TaxonomyNode {
  scientificName?: string;
  commonName?: string;
  rank?: string;
  parentId?: TaxonomyId;
}

/** Keyed by `String(taxonomyId)`; numeric ids index it unchanged. */
export type Taxonomy = Record<string, TaxonomyNode>;

export interface MSA {
  alphabet: 'dna' | 'protein';
  length: number;
  sequences: Record<GeneId, string>;
}

export type GeneMetadata = Record<GeneId, Record<string, unknown>>;

export interface NodeAnnotation {
  nodeId: NodeId;
  source: string;
  data: unknown;
}

export interface LabelProvider {
  id: string;
  label: string;
  fetch: (geneId: GeneId, signal: AbortSignal) => Promise<string | null>;
}

export interface ZoneViewState {
  id: string;
  width: number;
  visible: boolean;
  /**
   * True once the user has explicitly toggled this zone's visibility
   * (via the Zones popover). The chassis's auto-enable effect reveals a
   * zone the first time its data arrives, but only while the user hasn't
   * made a choice — once `userToggled` is set, the saved `visible` flag
   * is authoritative and auto-enable leaves it alone. This is what lets a
   * persisted/shared view restore a deliberately-hidden zone without it
   * popping back open when its async data lands.
   */
  userToggled?: boolean;
}

export interface SearchState {
  query: string;
  /**
   * Ids of registered `SearchField`s to EXCLUDE from this search.
   * Empty or undefined means "search every registered field" — the
   * default. Per-field checkboxes in the search bar maintain this
   * list so unticking a field persists into URL state without
   * forcing the host to enumerate every remaining field.
   */
  excludedFields?: string[];
  /** When false, queries are matched case-insensitively. Default false. */
  caseSensitive?: boolean;
  /** When true, `query` is interpreted as a regular expression. Bad
   *  regex strings produce zero matches and surface an error to the
   *  search bar without crashing the chassis. Default false. */
  regex?: boolean;
}

/** Cap on the number of matched leaves a single search can return.
 *  Pathological queries (empty string with substring matching, broad
 *  regex like `.`) would otherwise mark every leaf in a 50k-leaf
 *  tree, allocating a Set that big plus its ancestor closure. The
 *  cap is exposed alongside `SearchResults` so the search bar can
 *  show a "first N of many" badge. */
export const SEARCH_MATCH_LIMIT = 10_000;

export interface SearchResults {
  /** Leaf-node ids that matched the current query. Empty when search
   *  is null, the field id is unknown, the query is empty, or the
   *  query is a malformed regex. */
  matchedLeafIds: ReadonlySet<NodeId>;
  /** Closure of ancestor ids covering every matched leaf. The tree
   *  zone uses this to badge collapsed triangles that hide matches
   *  without forcing them open. Empty whenever `matchedLeafIds` is. */
  matchedAncestorIds: ReadonlySet<NodeId>;
  /** True when matching was capped at `SEARCH_MATCH_LIMIT` — the
   *  matched sets contain the first `SEARCH_MATCH_LIMIT` matches in
   *  tree-traversal order, not all matches. */
  truncated: boolean;
  /** Set when `regex` is on and the query failed to compile. The
   *  search bar should surface this; matched sets are empty. */
  regexError: string | null;
}

export interface MSAViewState {
  viewportStart: number;
  viewportEnd: number;
}

export interface LabelsViewState {
  visibleFields: string[];
}

export interface ViewState {
  selectedNodeId: NodeId | null;
  collapsedNodeIds: NodeId[];
  prunedNodeIds: NodeId[];
  /** Internal nodes whose children are rendered in reversed order. */
  swappedNodeIds: NodeId[];
  /**
   * Per-node *override* set for branch-length compression. The Tree zone
   * auto-compresses outlier-long branches (anything past a multiple of
   * the median); a node id appearing here flips the compression state of
   * its incoming branch — a normally-uncompressed branch becomes
   * compressed and vice versa, so users can pin specific branches either
   * way regardless of the auto rule.
   */
  compressedNodeIds: NodeId[];
  /** The leaf id designated as "node of interest". */
  nodeOfInterestId: NodeId | null;
  zones: ZoneViewState[];
  /**
   * Per-zone state, keyed by zone id. Built-in zones use well-known keys
   * (e.g. `labels`, `msa`) whose value type is the corresponding state interface
   * exported from this module. Pluggable zones own their own slots.
   */
  zoneStates: Record<string, unknown>;
  /**
   * Per-row height in px (leaf + collapsed-summary rows). Undefined falls
   * back to the `rowHeight` prop and then the built-in default (24). Lives
   * here so the Display control's choice persists in a saved/shared view.
   */
  rowHeight?: number;
  /**
   * Base font size in px (the `--tbrowse-font-size` var + canvas zone text).
   * Undefined falls back to the `fontSize` prop and then the default (12).
   */
  fontSize?: number;
  /**
   * Ids of `ZoneDefinition.exclusiveGroup` groups the user has decoupled
   * via the link toggle in the Zones panel. A group listed here allows
   * several of its zones on at once; absent (the default) it stays
   * mutually exclusive. Optional so pre-existing persisted view states
   * deserialize unchanged.
   */
  unlinkedZoneGroups?: string[];
  search: SearchState | null;
}

export interface VisibleRow {
  kind: 'leaf' | 'collapsedSummary';
  nodeId: NodeId;
  y: number;
  height: number;
  leafCount: number;
  /**
   * Animation opacity (0..1). Set by the chassis during transitions —
   * rows being added animate 0 → 1, rows being removed animate 1 → 0.
   * Undefined = settled at 1.
   */
  opacity?: number;
}

export interface RowRange {
  startIndex: number;
  endIndex: number;
}

/**
 * One gene in a leaf's genomic neighborhood (used by the
 * neighborhood-conservation zone). Coordinates are absolute on the
 * genome; `strand` drives arrow direction; `geneTree` is the family
 * identifier — neighbours sharing a `geneTree` value get the same
 * color, and undefined means "no family / non-protein-coding".
 */
export interface NeighborhoodGene {
  id: GeneId;
  name?: string;
  description?: string;
  /** 1 = forward strand, -1 = reverse. Anything else is normalised to 1. */
  strand: 1 | -1;
  start: number;
  end: number;
  /** Chromosome / scaffold name (e.g. "1", "Chr3", "scaffold_42"). */
  region?: string;
  biotype?: string;
  /** Gene-tree (family) accession; same value across genes ⇒ same color. */
  geneTree?: string;
}

/**
 * Per-leaf genomic-context window. `center` is the leaf gene itself;
 * `upstream` and `downstream` are up to ten flanking genes each, in
 * genomic order (leftmost first), so renderers can lay them out
 * directly without re-sorting.
 */
export interface Neighborhood {
  center: NeighborhoodGene;
  upstream: NeighborhoodGene[];
  downstream: NeighborhoodGene[];
}

/**
 * One exon of a transcript. Coordinates are absolute on the genome,
 * 1-based, inclusive. `cdsStart` / `cdsEnd` mark the coding portion of
 * this exon (clamped to the exon's own bounds); leaving them undefined
 * means the exon is fully UTR. For protein-coding transcripts the
 * concatenation of every exon's `[cdsStart..cdsEnd]` sub-range, walked
 * in transcript order, is the CDS — i.e. its length is `peptideLen * 3
 * + 3` (stop codon included) when the data is well-formed.
 */
export interface Exon {
  start: number;
  end: number;
  cdsStart?: number;
  cdsEnd?: number;
}

export interface Transcript {
  id: string;
  isCanonical?: boolean;
  /** e.g. "protein_coding", "nonsense_mediated_decay". The genome zone
   *  treats anything other than "protein_coding" as non-translating. */
  biotype?: string;
  /** Genomic order (ascending `start`); strand comes from the parent
   *  `GeneStructure` so every transcript on a gene shares it. */
  exons: Exon[];
}

/**
 * Per-leaf gene structure: gene span on the genome plus its transcripts
 * (canonical + alternates). The genome browser zone uses this to render
 * exon/intron diagrams; `canonicalTranscriptId` must match a transcript
 * id in `transcripts`. Strand applies to every transcript on the gene.
 */
export interface GeneStructure {
  /** Chromosome / scaffold name (e.g. "1", "Chr3", "scaffold_42"). */
  region: string;
  strand: 1 | -1;
  /** Gene span (5'UTR..3'UTR across all transcripts), genomic coords. */
  start: number;
  end: number;
  canonicalTranscriptId: string;
  transcripts: Transcript[];
  /** Optional human-readable gene symbol surfaced in tooltips. */
  name?: string;
}

/**
 * One genome annotation in the proximal region of a leaf gene
 * (e.g. transcription factor binding site, enhancer, repeat). Coords
 * are absolute on the genome. `kind` drives a default color bucket;
 * `category` overrides it when present so a host can group by motif
 * id, family, etc.
 */
export interface GenomeFeature {
  id: string;
  kind: string;
  start: number;
  end: number;
  strand?: 1 | -1;
  label?: string;
  category?: string;
}

/**
 * Per-leaf germplasm record. Mirrors the canonical BrAPI v2 /germplasm
 * shape so a host can surface its existing API response with no
 * remapping; non-germplasm trees leave this empty and the labels zone's
 * germplasm.* fields silently return null.
 *
 * `extras` is open-ended — BrAPI servers put anything outside the
 * standard column set into `extras`, and a host wanting to surface those
 * fields can supply a `LabelProvider` rather than asking the model to
 * grow yet another built-in field.
 */
export interface Germplasm {
  germplasmDbId?: string;
  germplasmName?: string;
  accessionNumber?: string;
  defaultDisplayName?: string;
  commonCropName?: string;
  genus?: string;
  species?: string;
  subtaxa?: string;
  countryOfOriginCode?: string;
  pedigree?: string;
  synonyms?: string[];
  extras?: Record<string, unknown>;
}

/**
 * One variant column in a genotype matrix. The id is whatever the host
 * uses to label the variant (typically `<chrom>:<pos>` or an rsId);
 * `position` lets a genotype zone show absolute coordinates in tooltips
 * and header readouts.
 */
export interface VariantSite {
  id: string;
  /** Reference name (chromosome / scaffold). */
  reference?: string;
  /** 1-based start position on `reference`. */
  position?: number;
  /** Reference base (e.g. "A"). */
  ref?: string;
  /** ALT alleles in order — `alt[0]` is allele "1", `alt[1]` is "2", etc. */
  alt?: string[];
  /** Optional alt-allele frequency. */
  alleleFrequency?: number;
}

/**
 * Per-leaf genotype matrix — variants on the x-axis, leaves on the
 * y-axis. Cell strings follow the BrAPI conventions: alleles separated
 * by `sepPhased` (default `"|"`) or `sepUnphased` (default `"/"`), and
 * `unknownString` (default `"."`) marks an uncalled allele.
 */
export interface GenotypeMatrix {
  /** Variant column descriptors, in display order. */
  variants: VariantSite[];
  /** Per-leaf genotype calls, parallel to `variants`, keyed by the leaf's
   *  `geneId` — the same convention every other per-leaf input uses. */
  callsByGeneId: Record<GeneId, string[]>;
  /** Phased separator (default `"|"`). */
  sepPhased?: string;
  /** Unphased separator (default `"/"`). */
  sepUnphased?: string;
  /** Token marking a missing / uncalled allele (default `"."`). */
  unknownString?: string;
  /** Optional human-readable region label, e.g. `"22:24,000,000–24,050,000"`. */
  regionLabel?: string;
}

/**
 * One protein-domain hit on a single leaf's protein sequence. Coordinates
 * are 1-based, inclusive, in the UNALIGNED residue index (i.e. positions
 * within the protein's amino-acid sequence — gaps in the MSA are not
 * counted). The MSA zone translates these on the fly into aligned-column
 * positions when it has access to the leaf's sequence in `msa.sequences`.
 */
export interface ProteinDomain {
  /** Stable identifier (e.g. Pfam accession "PF00069"). Drives the color. */
  id: string;
  /** Human-readable name (e.g. "Protein kinase domain"). */
  name: string;
  /** First residue (1-based, inclusive) in the unaligned protein. */
  start: number;
  /** Last residue (1-based, inclusive) in the unaligned protein. */
  end: number;
  /** Optional source label, surfaced in the tooltip. */
  source?: string;
}

export interface HostData {
  tree: Tree;
  taxonomy?: Taxonomy;
  msa?: MSA;
  geneMetadata?: GeneMetadata;
  nodeAnnotations?: NodeAnnotation[];
  labelProviders?: LabelProvider[];
  /**
   * Optional per-leaf protein-domain hits, keyed by GeneId. Renders as thin
   * colored bars below each MSA leaf row, spanning the domain's residue
   * range translated into MSA columns.
   */
  proteinDomains?: Record<GeneId, ProteinDomain[]>;
  /**
   * Optional per-leaf splice-junction positions, keyed by GeneId. Each
   * value is an array of 1-based UNALIGNED residue positions; the MSA
   * zone draws a thin vertical mark immediately to the right of that
   * residue's MSA column on the leaf's row. Gramene gene-tree leaves
   * carry these as `exon_junctions`.
   */
  exonJunctions?: Record<GeneId, number[]>;
  /**
   * Optional per-leaf genomic neighbourhoods. Drives the
   * neighborhood-conservation zone — each leaf's row shows its centre
   * gene plus up to 10 upstream + 10 downstream flanking genes.
   */
  neighborhood?: Record<GeneId, Neighborhood>;
  /**
   * Optional per-leaf gene structure (canonical + alternate transcripts
   * with exon/CDS coordinates). Drives the genome browser zone.
   */
  geneStructures?: Record<GeneId, GeneStructure>;
  /**
   * Optional per-leaf proximal genome features (TFBS, enhancers, etc.)
   * displayed as a track within the genome browser zone.
   */
  genomeFeatures?: Record<GeneId, GenomeFeature[]>;
  /**
   * Per-leaf fetch-error map for the genome browser zone. When a leaf's
   * geneId appears here AND is missing from `geneStructures`, the zone
   * renders an error glyph in the strand-indicator slot whose tooltip
   * surfaces this string. Lets a host serve a partial result when some
   * upstream lookups failed (network, 4xx, malformed payload) without
   * dropping the entire row.
   */
  geneStructureErrors?: Record<GeneId, string>;
  /**
   * Optional per-leaf germplasm metadata (BrAPI shape), keyed by the leaf's
   * `geneId` — for germplasm trees that holds the germplasmDbId /
   * germplasmName. Drives the labels zone's germplasm.* built-in fields.
   */
  germplasm?: Record<GeneId, Germplasm>;
  /**
   * Opaque host-supplied data channel. tbrowse passes this through
   * untouched onto `ZoneRenderProps.data.hostData`, letting a
   * host-defined zone read arbitrary per-row data (keyed however the
   * host likes — e.g. by taxon id) without the library knowing its
   * shape. Built-in zones ignore it.
   */
  hostData?: Record<string, unknown>;
}

/** A partial host-data bag — everything a data source can deliver besides the tree. */
export type HostDataPatch = Partial<Omit<HostData, 'tree'>>;

/** Per-zone async load status, as the viewer's `zoneStatus` prop expects it. */
export type ZoneStatus = 'loading' | 'error' | 'ready';
export type ZoneStatusMap = Record<string, ZoneStatus | undefined>;

/**
 * The pure half of the viewer's `ZoneDefinition`: what an initial view
 * state needs to know about a zone (id, default width share, default
 * per-zone state, availability, initial visibility, exclusive group). A
 * `ZoneDefinition` satisfies this structurally, so hosts pass their zone
 * list straight through to `buildInitialViewState`.
 */
export interface ZoneSpec<S = unknown> {
  id: string;
  /** Initial fr-share for the zone (the viewer lays zones out as fractions). */
  defaultWidth: number;
  /** Minimum pixel width; informational here (the viewer enforces it). */
  minWidth?: number;
  defaultZoneState: S;
  isAvailable: (data: HostData) => boolean;
  /** Initial visibility before the availability check (default true). */
  defaultVisible?: boolean;
  /** Mutually-exclusive group id; at most one member starts visible. */
  exclusiveGroup?: string;
}
