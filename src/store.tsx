import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { NodeId, TBrowseProps, ViewState } from './types';

export interface TBrowseState {
  viewState: ViewState;
  hoveredNodeId: NodeId | null;
  setHoveredNodeId: (id: NodeId | null) => void;
  setViewState: (next: ViewState | ((prev: ViewState) => ViewState)) => void;
}

export type TBrowseStore = StoreApi<TBrowseState>;

const baseDefaults: ViewState = {
  selectedNodeId: null,
  collapsedNodeIds: [],
  prunedNodeIds: [],
  zones: [],
  labels: { visibleFields: [] },
  search: null,
};

export function buildInitialViewState(props: TBrowseProps): ViewState {
  return {
    ...baseDefaults,
    zones: props.zones.map((z) => ({
      id: z.id,
      width: z.defaultWidth,
      visible: z.isAvailable({ tree: props.tree, taxonomy: props.taxonomy, msa: props.msa, geneMetadata: props.geneMetadata, nodeAnnotations: props.nodeAnnotations, labelProviders: props.labelProviders }),
    })),
    ...props.initialViewState,
  };
}

export function createTBrowseStore(props: TBrowseProps): TBrowseStore {
  const initial = props.viewState ?? buildInitialViewState(props);
  return createStore<TBrowseState>((set) => ({
    viewState: initial,
    hoveredNodeId: null,
    setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
    setViewState: (next) =>
      set((s) => ({
        viewState: typeof next === 'function' ? next(s.viewState) : next,
      })),
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
