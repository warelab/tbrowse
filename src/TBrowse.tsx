import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  createTBrowseStore,
  TBrowseStoreProvider,
  useTBrowseStore,
  DEFAULT_FONT_SIZE,
} from './store';
import { Layout } from './layout/Layout';
import { ensureThemeStylesInjected } from './theme';
import type { HostData, TBrowseProps } from './types';

// Inject the theme stylesheet once, at module load. Idempotent and
// SSR-safe; the helper no-ops when there's no document.
ensureThemeStylesInjected();

export function TBrowse(props: TBrowseProps) {
  const store = useMemo(() => createTBrowseStore(props), []);

  const propViewState = props.viewState;
  const onChange = props.onViewStateChange;
  const isControlled = propViewState !== undefined;

  const lastEmitted = useRef(store.getState().viewState);

  // Mirror a controlled `viewState` prop into the store. We use
  // useLayoutEffect (NOT plain useEffect) so the sync runs synchronously
  // after commit and before the browser paints — preserving the
  // single-paint guarantee when a host swaps a new tree + matching pivot
  // viewState atomically. A plain useEffect would defer past paint and
  // briefly show the new tree against the old viewState.
  //
  // The earlier "set during render" version produced the same single-
  // paint outcome but triggered React's "Cannot update a component while
  // rendering a different component" warning when zustand notified
  // already-rendering subscribers mid-tree. Moving to layout effects
  // keeps the timing tight while staying inside React's invariants.
  const propTheme = props.theme ?? 'light';
  useLayoutEffect(() => {
    if (
      isControlled &&
      propViewState !== undefined &&
      store.getState().viewState !== propViewState
    ) {
      lastEmitted.current = propViewState;
      store.setState({ viewState: propViewState });
    }
  }, [isControlled, propViewState, store]);

  // Mirror the theme prop into the store so portaled tooltips/popovers,
  // which render outside the chassis DOM subtree, can re-apply the
  // `tbrowse-theme-*` class on their wrappers and pick up the CSS vars.
  useLayoutEffect(() => {
    if (store.getState().theme !== propTheme) {
      store.setState({ theme: propTheme });
    }
  }, [propTheme, store]);

  // Keep the store's numeric `fontSize` (read by canvas-drawn zones like the
  // MSA grid, and by the root CSS var below) synced to the EFFECTIVE size:
  // `viewState.fontSize ?? fontSize prop ?? default`. viewState wins so the
  // Display control's edits take effect; a subscription re-syncs whenever the
  // controlled view state changes.
  const propFontSize = props.fontSize;
  useLayoutEffect(() => {
    const effective = (vsFontSize?: number) =>
      vsFontSize ?? propFontSize ?? DEFAULT_FONT_SIZE;
    const apply = () => {
      const eff = effective(store.getState().viewState.fontSize);
      if (store.getState().fontSize !== eff) store.setState({ fontSize: eff });
    };
    apply();
    return store.subscribe(apply);
  }, [propFontSize, store]);

  useEffect(() => {
    if (!onChange) return;
    return store.subscribe((state) => {
      if (state.viewState !== lastEmitted.current) {
        lastEmitted.current = state.viewState;
        onChange(state.viewState);
      }
    });
  }, [onChange, store]);

  return (
    <TBrowseStoreProvider store={store}>
      <TBrowseShell {...props} />
    </TBrowseStoreProvider>
  );
}

function TBrowseShell(props: TBrowseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const data: HostData = {
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
    geneStructureErrors: props.geneStructureErrors,
    hostData: props.hostData,
  };

  // Effective font size (viewState ?? prop ?? default), kept in the store by
  // the sync effect above. Drive the CSS var from it so the Display control's
  // edits reflow DOM zone text without any prop change.
  const effectiveFontSize = useTBrowseStore((s) => s.fontSize);
  const rootStyle: CSSProperties = {
    width: '100%',
    height: props.autoHeight ? 'auto' : '100%',
    ['--tbrowse-font-size' as string]: `${effectiveFontSize}px`,
  };

  return (
    <div
      ref={containerRef}
      className={`tbrowse-root tbrowse-theme-${props.theme ?? 'light'} ${props.className ?? ''}`}
      style={rootStyle}
    >
      <Layout
        data={data}
        zones={props.zones}
        searchFields={props.searchFields}
        hotkeys={props.hotkeys}
        defaultOpenSections={props.defaultOpenSections}
        zoneStatus={props.zoneStatus}
        showHeader={props.showHeader ?? true}
        rowHeight={props.rowHeight}
        fontSize={props.fontSize}
        densityControls={props.densityControls}
        headerActions={props.headerActions}
        autoHeight={props.autoHeight}
        containerRef={containerRef}
      />
    </div>
  );
}
