import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { computePivotState } from './pivot';
import type { GeneId, NodeId, TBrowseProps, ViewState } from './types';

/**
 * The residue under the pointer in the MSA zone. Only set while the zone is
 * zoomed in far enough to render residue text, and only for leaf rows (a
 * collapsed-summary consensus has no protein of its own). Transient UI state
 * — deliberately not part of `viewState`, so hovering never touches the URL.
 */
export interface HoveredResidue {
  nodeId: NodeId;
  geneId: GeneId;
  /** Original (pre-mask) MSA column index. */
  column: number;
  /** 1-based residue position in the leaf's UNALIGNED sequence. */
  position: number;
  /** Residue character at that position (never a gap). */
  residue: string;
}

export interface TBrowseState {
  viewState: ViewState;
  hoveredNodeId: NodeId | null;
  hoveredResidue: HoveredResidue | null;
  /**
   * Active visual theme. Mirrored from the host's `theme` prop on every
   * render. Read by components that render outside the chassis DOM
   * subtree (portaled tooltips / popovers) so they can reattach the
   * `tbrowse-theme-*` class and pick up the CSS custom properties.
   */
  theme: 'light' | 'dark';
  /**
   * Base font size in px, mirrored from the host's `fontSize` prop. DOM zone
   * text reads it via the `--tbrowse-font-size` CSS var; canvas-drawn zones
   * (e.g. the MSA residue grid) read this numeric value directly since a
   * canvas context can't resolve CSS vars.
   */
  fontSize: number;
  setHoveredNodeId: (id: NodeId | null) => void;
  setHoveredResidue: (residue: HoveredResidue | null) => void;
  setViewState: (next: ViewState | ((prev: ViewState) => ViewState)) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setFontSize: (fontSize: number) => void;
}

/** Default base font size when the host doesn't pass `fontSize`. */
export const DEFAULT_FONT_SIZE = 12;

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
    neighborhood: props.neighborhood,
    geneStructures: props.geneStructures,
    genomeFeatures: props.genomeFeatures,
    hostData: props.hostData,
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
    // NB: rowHeight / fontSize are intentionally left unset here. They resolve
    // at read time as `viewState.<x> ?? <x> prop ?? default`, so a host that
    // drives density via prop changes (the playground) stays reactive; the
    // Display control writes them into view state, which then wins.
    zones: (() => {
      // Mutually-exclusive groups start linked, so at most one member may
      // be visible on first paint — the first that qualifies wins.
      const claimed = new Set<string>();
      return props.zones.map((z) => {
        // Initial visibility = (the zone opts in via `defaultVisible`,
        //  default true) AND (its data is available right now). Zones
        // that opt out (defaultVisible: false) stay hidden on first
        // paint and rely on the chassis's auto-enable effect to flip
        // them on once their data has been observed.
        let visible = (z.defaultVisible ?? true) && z.isAvailable(data);
        if (visible && z.exclusiveGroup) {
          if (claimed.has(z.exclusiveGroup)) visible = false;
          else claimed.add(z.exclusiveGroup);
        }
        return { id: z.id, width: z.defaultWidth, visible };
      });
    })(),
    zoneStates,
    ...props.initialViewState,
  };
}

export function createTBrowseStore(props: TBrowseProps): TBrowseStore {
  const initial = props.viewState ?? buildInitialViewState(props);
  return createStore<TBrowseState>((set) => ({
    viewState: initial,
    hoveredNodeId: null,
    hoveredResidue: null,
    theme: props.theme ?? 'light',
    fontSize: props.fontSize ?? DEFAULT_FONT_SIZE,
    setHoveredNodeId: (id) => set({ hoveredNodeId: id }),
    setHoveredResidue: (residue) => set({ hoveredResidue: residue }),
    setViewState: (next) =>
      set((s) => ({
        viewState: typeof next === 'function' ? next(s.viewState) : next,
      })),
    setTheme: (theme) => set({ theme }),
    setFontSize: (fontSize) => set({ fontSize }),
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
