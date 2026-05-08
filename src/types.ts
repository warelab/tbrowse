import type { ComponentType, ReactNode } from 'react';

export type NodeId = string;
export type GeneId = string;
export type TaxonomyId = number;

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

export type Taxonomy = Record<TaxonomyId, TaxonomyNode>;

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
 * One protein-domain hit on a single leaf's protein sequence. Coordinates
 * are 1-based, inclusive, in the UNALIGNED residue index (i.e. positions
 * within the protein's amino-acid sequence — gaps in the MSA are not
 * counted). The MSA zone translates these on the fly into aligned-column
 * positions when it has access to the leaf's sequence in `msa.sequences`.
 */
/**
 * One gene in a leaf's genomic neighborhood (used by the
 * neighborhood-conservation zone). Coordinates are absolute on the
 * genome; `strand` drives arrow direction; `geneTree` is the family
 * identifier — neighbours sharing a `geneTree` value get the same
 * colour, and undefined means "no family / non-protein-coding".
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
  /** Gene-tree (family) accession; same value across genes ⇒ same colour. */
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
 * are absolute on the genome. `kind` drives a default colour bucket;
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
   * coloured bars below each MSA leaf row, spanning the domain's residue
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
}

export interface ZoneRenderProps<S = unknown> {
  visibleRows: VisibleRow[];
  rowRange: RowRange;
  hoveredNodeId: NodeId | null;
  /**
   * Closure of hovered node and its descendants. Empty set when nothing is
   * hovered. Non-tree zones use this to highlight the rows whose leaves are
   * within the hovered subtree.
   */
  hoveredSubtreeIds: ReadonlySet<NodeId>;
  selectedNodeId: NodeId | null;
  collapsedNodeIds: ReadonlySet<NodeId>;
  prunedNodeIds: ReadonlySet<NodeId>;
  swappedNodeIds: ReadonlySet<NodeId>;
  /** Active search query — the raw state and the resolved match
   *  sets. Zones consume `searchResults` to render highlights;
   *  `searchState` is exposed so a zone can surface its own match
   *  spans (e.g. labels highlighting the matching substring). */
  searchState: SearchState | null;
  searchResults: SearchResults;
  /** Branch-compression overrides — see ViewState.compressedNodeIds. */
  compressedNodeIds: ReadonlySet<NodeId>;
  onHoverNode: (id: NodeId | null) => void;
  onSelectNode: (id: NodeId) => void;
  onClearSelection: () => void;
  onToggleCollapsed: (id: NodeId) => void;
  onTogglePruned: (id: NodeId) => void;
  onToggleSwapped: (id: NodeId) => void;
  /** Flip the auto-determined compression state for this node's branch. */
  onToggleCompressed: (id: NodeId) => void;
  /** Remove every descendant of `id` from collapsedNodeIds. */
  onExpandSubtree: (id: NodeId) => void;
  /**
   * Designate `id` as the new node of interest. Swaps ancestors so the
   * leaf sits at the top of the display; does not collapse any branches.
   */
  onMakeNodeOfInterest: (id: NodeId) => void;
  /**
   * Reveal every leaf whose taxonomyId matches the leaf at `id`
   * (its paralogs) without exposing unrelated subtrees. For each
   * ancestor on a paralog's root-path that is currently collapsed,
   * the ancestor is uncollapsed AND its non-paralog-path internal
   * children are collapsed in turn — so newly-visible ancestors
   * don't drag their entire subtrees into view. Already-uncollapsed
   * ancestors are left alone (their existing visibility is treated
   * as intentional). Pruned leaves are not touched.
   */
  onShowParalogs: (id: NodeId) => void;
  /**
   * Prune every sibling branch on the path from `id` up to the root —
   * i.e. for each ancestor of `id`, every child that's not on the path
   * is added to prunedNodeIds. Any path-node currently collapsed is
   * uncollapsed so the rerooted lineage is fully visible. Existing
   * unrelated prunes are preserved.
   */
  onReroot: (id: NodeId) => void;
  /**
   * Inverse of `onReroot`: remove from prunedNodeIds any sibling branch
   * on the path from `id` up to the root. Deeper manual prunes inside
   * those subtrees are NOT touched, so a Prune-others / Regrow-others
   * round trip leaves the tree state where it started.
   */
  onRegrowOthers: (id: NodeId) => void;
  /** Resolved id of the current node of interest (null until set). */
  nodeOfInterestId: NodeId | null;
  zoneState: S;
  setZoneState: (next: S | ((prev: S) => S)) => void;
  width: number;
  bodyHeight: number;
  bodyScrollLeft: number;
  setBodyScrollLeft: (next: number | ((prev: number) => number)) => void;
  data: HostData;
}

export interface ZoneDefinition<S = unknown> {
  id: string;
  displayName: string;
  Header: ComponentType<ZoneRenderProps<S>>;
  Body: ComponentType<ZoneRenderProps<S>>;
  /**
   * Initial fr-share for this zone. The chassis lays zones out as
   * fractions of the container width — `defaultWidth: 30` for tree,
   * `20` for labels, `50` for msa gives 30 % / 20 % / 50 %. Resizing
   * adjusts these fr values without changing the total, so the
   * component always fills its container.
   */
  defaultWidth: number;
  /**
   * Minimum pixel width below which the resize handle won't shrink
   * this zone. Honoured by the grid via `minmax(<minWidth>px, <fr>fr)`,
   * so if zones can't fit within the container they overflow into a
   * horizontal scroll rather than getting squashed.
   */
  minWidth: number;
  defaultZoneState: S;
  isAvailable: (data: HostData) => boolean;
  /**
   * Initial visibility before any data-availability check runs.
   * Default `true` — the zone shows on first paint as long as
   * `isAvailable(data)` agrees. Set to `false` for zones that
   * should stay hidden until their data is observed (e.g. the
   * neighborhood zone, which defaults to off and auto-enables
   * the first time neighbourhood data appears in `HostData`).
   */
  defaultVisible?: boolean;
  /**
   * Optional contributor: returns SearchFields the zone wants to add
   * to the search-bar dropdown based on its current state and data.
   * Called whenever this zone's state changes; results merge with the
   * host's `searchFields` prop and the built-ins (last-wins on
   * duplicate id). Lets a zone expose state-dependent search choices
   * (e.g. a user-marked "searchable" column on a table zone) without
   * forcing the host to mirror that state.
   */
  getSearchFields?: (
    zoneState: S,
    data: HostData,
  ) => import('./search/fields').SearchField[];
}

export interface TBrowseProps {
  tree: Tree;
  taxonomy?: Taxonomy;
  msa?: MSA;
  geneMetadata?: GeneMetadata;
  nodeAnnotations?: NodeAnnotation[];
  proteinDomains?: Record<GeneId, ProteinDomain[]>;
  exonJunctions?: Record<GeneId, number[]>;
  /**
   * Optional per-leaf genomic neighbourhoods. Drives the
   * neighborhood-conservation zone — each leaf's row shows its centre
   * gene plus up to 10 upstream + 10 downstream flanking genes.
   */
  neighborhood?: Record<GeneId, Neighborhood>;
  /** Optional per-leaf gene structures (drives the genome browser zone). */
  geneStructures?: Record<GeneId, GeneStructure>;
  /** Optional per-leaf proximal genome features (TFBS, enhancers, etc.). */
  genomeFeatures?: Record<GeneId, GenomeFeature[]>;
  /** Optional per-leaf fetch-error map; rows with an entry here but no
   *  `geneStructures` entry render a warning glyph with this message. */
  geneStructureErrors?: Record<GeneId, string>;
  /**
   * If provided, the initial view collapses every subtree except the path
   * to this node and swaps siblings so the node sits at the top of the
   * display. Resolved as a leaf `geneId` first, then as a node `id`. Has
   * effect only when the chassis builds the initial viewState
   * (uncontrolled mode); controlled hosts can call `computePivotState`
   * themselves to bootstrap their viewState.
   */
  nodeOfInterest?: string;
  zones: ZoneDefinition[];
  labelProviders?: LabelProvider[];
  /**
   * Global keyboard-shortcut configuration. Hosts that own their own
   * `/` or Cmd/Ctrl-F handlers (e.g. an outer site-wide search bar)
   * should opt out via `hotkeys: { search: false }` to avoid
   * conflicting focus-stealing. The TBrowse search panel can still
   * be opened programmatically by writing to `ViewState.search`.
   *
   * When enabled (the default), the hotkeys only fire while the
   * user is interacting with the chassis — i.e. their cursor is
   * over it or their keyboard focus is inside it — so host
   * listeners outside that region remain unaffected.
   */
  hotkeys?: {
    /** Default true — `/` and Cmd/Ctrl-F open and focus the search
     *  panel. Set to false to free those keys for the host. */
    search?: boolean;
  };
  /**
   * Additional search-bar field choices on top of the built-in set
   * (gene id, taxonomy scientific / common name, node id). Hosts can
   * use this to expose metadata- or zone-specific searches (e.g. a
   * Pfam id, a custom annotation key) without forking the library.
   */
  searchFields?: import('./search/fields').SearchField[];
  viewState?: ViewState;
  initialViewState?: Partial<ViewState>;
  onViewStateChange?: (next: ViewState) => void;
  theme?: 'light' | 'dark';
  className?: string;
  children?: ReactNode;
}
