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
  selectedNodeId: NodeId | null;
  onHoverNode: (id: NodeId | null) => void;
  onSelectNode: (id: NodeId) => void;
  zoneState: S;
  setZoneState: (next: S | ((prev: S) => S)) => void;
  width: number;
  bodyHeight: number;
  bodyScrollLeft: number;
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
  zones: ZoneDefinition[];
  labelProviders?: LabelProvider[];
  viewState?: ViewState;
  initialViewState?: Partial<ViewState>;
  onViewStateChange?: (next: ViewState) => void;
  theme?: 'light' | 'dark';
  className?: string;
  children?: ReactNode;
}
