import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { computePivotState } from './pivot';
import type { NodeId, TBrowseProps, ViewState } from './types';

export interface TBrowseState {
  viewState: ViewState;
  hoveredNodeId: NodeId | null;
  /**
   * Active visual theme. Mirrored from the host's `theme` prop on every
   * render. Read by components that render outside the chassis DOM
   * subtree (portaled tooltips / popovers) so they can reattach the
   * `tbrowse-theme-*` class and pick up the CSS custom properties.
   */
  theme: 'light' | 'dark';
  setHoveredNodeId: (id: NodeId | null) => void;
  setViewState: (next: ViewState | ((prev: ViewState) => ViewState)) => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export type TBrowseStore = StoreApi<TBrowseState>;

const baseDefaults: ViewState = {
  selectedNodeId: null,
  collapsedNodeIds: [],
  prunedNodeIds: [],
  swappedNodeIds: [],
  compressedNodeIds: [],
  nodeOfInterestId: null,
  zones: [],
  zoneStates: {},
  search: null,
};

export function buildInitialViewState(props: TBrowseProps): ViewState {
  const data = {
    tree: props.tree,
    taxonomy: props.taxonomy,
    msa: props.msa,
    geneMetadata: props.geneMetadata,
    nodeAnnotations: props.nodeAnnotations,
    labelProviders: props.labelProviders,
    proteinDomains: props.proteinDomains,
    exonJunctions: props.exonJunctions,
  };
  const zoneStates: Record<string, unknown> = {};
  for (const z of props.zones) {
    zoneStates[z.id] = z.defaultZoneState;
  }

  let collapsedFromPivot: NodeId[] = [];
  let swappedFromPivot: NodeId[] = [];
  let nodeOfInterestId: NodeId | null = null;
  if (props.nodeOfInterest) {
    const pivot = computePivotState(props.tree, props.nodeOfInterest);
    if (pivot) {
      collapsedFromPivot = pivot.collapsedNodeIds;
      swappedFromPivot = pivot.swappedNodeIds;
      nodeOfInterestId = pivot.targetId;
    }
  }

  return {
    ...baseDefaults,
    collapsedNodeIds: collapsedFromPivot,
    swappedNodeIds: swappedFromPivot,
    nodeOfInterestId,
    zones: props.zones.map((z) => ({
      id: z.id,
      width: z.defaultWidth,
      visible: z.isAvailable(data),
    })),
    zoneStates,
    ...props.initialViewState,
  };
}

export function createTBrowseStore(props: TBrowseProps): TBrowseStore {
  const initial = props.viewState ?? buildInitialViewState(props);
  return createStore<TBrowseState>((set) => ({
    viewState: initial,
    hoveredNodeId: null,
    theme: props.theme ?? 'light',
    setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
    setViewState: (next) =>
      set((s) => ({
        viewState: typeof next === 'function' ? next(s.viewState) : next,
      })),
    setTheme: (theme) => set({ theme }),
  }));
}

const StoreContext = createContext<TBrowseStore | null>(null);

export function TBrowseStoreProvider({
  store,
  children,
}: {
  store: TBrowseStore;
  children: ReactNode;
}) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useTBrowseStore<T>(selector: (state: TBrowseState) => T): T {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useTBrowseStore must be used within <TBrowse>');
  return useStore(store, selector);
}
