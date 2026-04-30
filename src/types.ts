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
  field: string;
  query: string;
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

export interface HostData {
  tree: Tree;
  taxonomy?: Taxonomy;
  msa?: MSA;
  geneMetadata?: GeneMetadata;
  nodeAnnotations?: NodeAnnotation[];
  labelProviders?: LabelProvider[];
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
  onHoverNode: (id: NodeId | null) => void;
  onSelectNode: (id: NodeId) => void;
  onClearSelection: () => void;
  onToggleCollapsed: (id: NodeId) => void;
  onTogglePruned: (id: NodeId) => void;
  onToggleSwapped: (id: NodeId) => void;
  /** Remove every descendant of `id` from collapsedNodeIds. */
  onExpandSubtree: (id: NodeId) => void;
  /**
   * Designate `id` as the new node of interest. Swaps ancestors so the
   * leaf sits at the top of the display; does not collapse any branches.
   */
  onMakeNodeOfInterest: (id: NodeId) => void;
  /**
   * Uncollapse any ancestor that hides a leaf whose taxonomyId matches
   * the leaf at `id`. Pruned leaves are not touched.
   */
  onShowParalogs: (id: NodeId) => void;
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
  defaultWidth: number;
  minWidth: number;
  defaultZoneState: S;
  isAvailable: (data: HostData) => boolean;
}

export interface TBrowseProps {
  tree: Tree;
  taxonomy?: Taxonomy;
  msa?: MSA;
  geneMetadata?: GeneMetadata;
  nodeAnnotations?: NodeAnnotation[];
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
  viewState?: ViewState;
  initialViewState?: Partial<ViewState>;
  onViewStateChange?: (next: ViewState) => void;
  theme?: 'light' | 'dark';
  className?: string;
  children?: ReactNode;
}
