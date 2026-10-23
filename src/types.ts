import type { ComponentType, ReactNode } from 'react';
import type {
  GeneId,
  GeneStructure,
  GenomeFeature,
  GeneMetadata,
  Germplasm,
  HostData,
  LabelProvider,
  MSA,
  Neighborhood,
  NodeAnnotation,
  NodeId,
  ProteinDomain,
  SearchResults,
  SearchState,
  Taxonomy,
  Tree,
  ViewState,
  VisibleRow,
  RowRange,
  ZoneSpec,
  ZoneStatusMap,
} from 'tbrowse-core';

/**
 * The data model (Tree, Taxonomy, MSA, HostData, ViewState, ...) is owned by
 * tbrowse-core and re-exported here unchanged, so `import type { Tree } from
 * 'tbrowse'` keeps working and names the same type as
 * `import type { Tree } from 'tbrowse-core'`. Only the React-facing
 * contracts (zone render props, zone definitions, component props) are
 * declared in this file.
 */
export type {
  NodeId,
  GeneId,
  TaxonomyId,
  TreeNode,
  Tree,
  TaxonomyNode,
  Taxonomy,
  MSA,
  GeneMetadata,
  NodeAnnotation,
  LabelProvider,
  ZoneViewState,
  SearchState,
  SearchResults,
  MSAViewState,
  LabelsViewState,
  ViewState,
  VisibleRow,
  RowRange,
  NeighborhoodGene,
  Neighborhood,
  Exon,
  Transcript,
  GeneStructure,
  GenomeFeature,
  Germplasm,
  VariantSite,
  GenotypeMatrix,
  ProteinDomain,
  HostData,
  HostDataPatch,
  ZoneStatus,
  ZoneStatusMap,
  ZoneSpec,
} from 'tbrowse-core';
export { SEARCH_MATCH_LIMIT } from 'tbrowse-core';

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

/**
 * A zone plug-in. The pure half (`id`, `defaultWidth`, `defaultZoneState`,
 * `isAvailable`, `defaultVisible`, `exclusiveGroup`) is `ZoneSpec` from
 * tbrowse-core, so headless code (`buildInitialViewState`) can take a zone
 * list without knowing about React; the rendering half lives here.
 */
export interface ZoneDefinition<S = unknown> extends ZoneSpec<S> {
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
   * Opt this zone into a mutually-exclusive group. Zones sharing a group
   * id render in the Zones panel as one segmented control (like the
   * genome header's CDS|Gene|±2kb trio) and, by default, only one of
   * them can be visible at a time — turning one on turns its siblings
   * off. The user can decouple a group via the link toggle beside the
   * control, after which its members behave as independent toggles;
   * that choice persists in `ViewState.unlinkedZoneGroups`.
   *
   * Host-defined zones can join a built-in group by declaring the same
   * id (the built-ins use `'detail'`).
   */
  exclusiveGroup?: string;
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
  /** Optional per-leaf germplasm metadata (BrAPI shape). Drives the
   *  labels zone's germplasm.* built-in fields (tbrowse 2.12+). */
  germplasm?: Record<GeneId, Germplasm>;
  /**
   * If provided, the initial view collapses every subtree except the path
   * to this node and swaps siblings so the node sits at the top of the
   * display. Resolved as a leaf `geneId` first, then as a node `id`. Has
   * effect only when the chassis builds the initial viewState
   * (uncontrolled mode); controlled hosts can call `computePivotState`
   * themselves to bootstrap their viewState.
   */
  nodeOfInterest?: string;
  /**
   * The zone list. Typed `ZoneDefinition<any>[]` rather than
   * `ZoneDefinition<unknown>[]` because a host's list mixes zones with
   * different per-zone state types (`treeZone` is a
   * `ZoneDefinition<TreeZoneState>`, `labelsZone` a
   * `ZoneDefinition<LabelsZoneState>`, …) and `S` appears in both
   * covariant and contravariant positions of the render props, so the
   * narrower element type would reject every mixed list.
   */
  zones: ZoneDefinition<any>[];
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
   * Initial open state for the toolbar disclosure sections. Each
   * panel still toggles freely once the user clicks it — this only
   * controls what's shown on first paint. Defaults: `zones: false`
   * (the toolbar starts compact); `search: false` *unless* the
   * initial `ViewState.search.query` is non-empty, in which case
   * the search panel auto-opens so the user can see their query.
   * Hosts that always want the zone-toggle row visible (e.g. for
   * discoverability in an embedded view) can pass
   * `defaultOpenSections: { zones: true }`.
   */
  defaultOpenSections?: {
    search?: boolean;
    zones?: boolean;
    /** Initial open state of the Display section (row-height / font-size
     *  sliders). Only meaningful when `densityControls` is enabled. */
    display?: boolean;
  };
  /**
   * Per-zone load status, keyed by zone id. Lets the host signal that
   * the data backing a zone is asynchronously in flight (`'loading'`),
   * has failed (`'error'`), or has settled (`'ready'`). The Zones
   * toggle row picks the status up visually:
   *  - `'loading'`: button gently pulses opacity.
   *  - `'error'`: button gains a red border + tinted background; a
   *    tooltip surfaces the cause.
   *  - `'ready'` / omitted: normal styling.
   *
   * This does NOT gate visibility — it's purely a UX affordance.
   * Pair the status with the corresponding data prop so the existing
   * `isAvailable(data)` predicate still decides whether the zone body
   * has anything to render.
   */
  zoneStatus?: ZoneStatusMap;
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
  /**
   * Show the top toolbar (logo + Search/Zones disclosure). Default true.
   * Set false to embed tbrowse chrome-less — e.g. as a sub-panel inside a
   * host view that supplies its own controls. Per-zone column headers are
   * unaffected.
   */
  showHeader?: boolean;
  /**
   * *Initial* per-row height in px for leaf and collapsed-summary rows
   * (default 24). Seeds `ViewState.rowHeight`; once set there (e.g. by the
   * Display control) that value wins. Lets a host pack more rows (a
   * species-distribution view with many genomes) or give rows more room.
   */
  rowHeight?: number;
  /**
   * *Initial* base font size in px, exposed as the `--tbrowse-font-size` CSS
   * variable on the chassis root. Seeds `ViewState.fontSize`; the effective
   * size is `ViewState.fontSize ?? fontSize ?? 12`. Zone text that opts into
   * the variable scales with it.
   */
  fontSize?: number;
  /**
   * Show the built-in "Display" toolbar section — row-height and font-size
   * sliders that write `ViewState.rowHeight` / `ViewState.fontSize`, so the
   * chosen density round-trips through a controlled/persisted view state.
   * Default false (the playground supplies its own external controls).
   */
  densityControls?: boolean;
  /**
   * Opaque host data passed through to `ZoneRenderProps.data.hostData` for
   * host-defined zones. See `HostData.hostData`.
   */
  hostData?: Record<string, unknown>;
  /**
   * Host-supplied controls rendered right-aligned in the toolbar (only when
   * `showHeader` is true). Lets a host put view-specific actions inside the
   * tbrowse chrome instead of in a separate bar above it.
   */
  headerActions?: ReactNode;
  /**
   * Size the chassis to its content instead of filling (and scrolling within)
   * the container. When true the body grows to fit every row — no internal
   * vertical scrollbar and no empty space below the last row — so the
   * component's height equals header + all rows. The host's wrapper should
   * then use `height: auto` (or a `max-height`) rather than a fixed height.
   * All rows are rendered (row virtualization is bypassed). Default false:
   * the chassis fills its container and scrolls overflow internally.
   */
  autoHeight?: boolean;
  className?: string;
  children?: ReactNode;
}
