import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createTBrowseStore, TBrowseStoreProvider } from './store';
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

  // Mirror the fontSize prop into the store so canvas-drawn zones (MSA) can
  // read the numeric value; DOM zones additionally pick up the CSS var set on
  // the root below.
  const propFontSize = props.fontSize;
  useLayoutEffect(() => {
    if (propFontSize !== undefined && store.getState().fontSize !== propFontSize) {
      store.setState({ fontSize: propFontSize });
    }
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

  const rootStyle: CSSProperties = {
    width: '100%',
    height: props.autoHeight ? 'auto' : '100%',
  };
  if (typeof props.fontSize === 'number') {
    (rootStyle as Record<string, string | number>)['--tbrowse-font-size'] =
      `${props.fontSize}px`;
  }

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
        headerActions={props.headerActions}
        autoHeight={props.autoHeight}
        containerRef={containerRef}
      />
    </div>
  );
}
