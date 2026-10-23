import { createContext, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import { buildInitialViewState as coreBuildInitialViewState } from 'tbrowse-core';
import type { GeneId, HostData, NodeId, TBrowseProps, ViewState } from './types';

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

/** The host-data bag the chassis derives from its props (what zones' `isAvailable` sees). */
function hostDataOf(props: TBrowseProps): HostData {
  return {
    tree: props.tree,
    ...(props.taxonomy !== undefined ? { taxonomy: props.taxonomy } : {}),
    ...(props.msa !== undefined ? { msa: props.msa } : {}),
    ...(props.geneMetadata !== undefined ? { geneMetadata: props.geneMetadata } : {}),
    ...(props.nodeAnnotations !== undefined ? { nodeAnnotations: props.nodeAnnotations } : {}),
    ...(props.labelProviders !== undefined ? { labelProviders: props.labelProviders } : {}),
    ...(props.proteinDomains !== undefined ? { proteinDomains: props.proteinDomains } : {}),
    ...(props.exonJunctions !== undefined ? { exonJunctions: props.exonJunctions } : {}),
    ...(props.neighborhood !== undefined ? { neighborhood: props.neighborhood } : {}),
    ...(props.geneStructures !== undefined ? { geneStructures: props.geneStructures } : {}),
    ...(props.genomeFeatures !== undefined ? { genomeFeatures: props.genomeFeatures } : {}),
    ...(props.germplasm !== undefined ? { germplasm: props.germplasm } : {}),
    ...(props.hostData !== undefined ? { hostData: props.hostData } : {}),
  };
}

/**
 * Initial view state for an uncontrolled chassis. The logic (zoneStates
 * seeded from each zone's `defaultZoneState`, the `nodeOfInterest` pivot,
 * `(defaultVisible ?? true) && isAvailable(data)`, exclusive-group
 * first-wins, `initialViewState` spread last) lives in tbrowse-core's
 * `buildInitialViewState` so hosts that drive a controlled view state can
 * run exactly the same routine. rowHeight / fontSize are intentionally left
 * unset: they resolve at read time as `viewState.<x> ?? <x> prop ?? default`.
 */
export function buildInitialViewState(props: TBrowseProps): ViewState {
  return coreBuildInitialViewState(props.zones, {
    data: hostDataOf(props),
    ...(props.nodeOfInterest !== undefined ? { nodeOfInterest: props.nodeOfInterest } : {}),
    ...(props.initialViewState !== undefined ? { overrides: props.initialViewState } : {}),
  });
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
