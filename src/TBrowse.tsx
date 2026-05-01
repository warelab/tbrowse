import { useEffect, useMemo, useRef } from 'react';
import { createTBrowseStore, TBrowseStoreProvider } from './store';
import { Layout } from './layout/Layout';
import type { HostData, TBrowseProps } from './types';

export function TBrowse(props: TBrowseProps) {
  const store = useMemo(() => createTBrowseStore(props), []);

  const propViewState = props.viewState;
  const onChange = props.onViewStateChange;
  const isControlled = propViewState !== undefined;

  const lastEmitted = useRef(store.getState().viewState);

  // Synchronously mirror a controlled `viewState` prop into the store
  // DURING render. Doing this in a useEffect would defer the sync by one
  // commit — long enough that the host can swap in a new tree + matching
  // pivot view state in a single batch and have the chassis paint once
  // with the new tree against the OLD viewState (no pivot, all leaves
  // briefly visible) before the effect fires the second render. Setting
  // store state during render is safe for Zustand because subscribers
  // use useSyncExternalStore — they pick up the latest snapshot when
  // they (re)render later in this pass.
  if (
    isControlled &&
    propViewState !== undefined &&
    store.getState().viewState !== propViewState
  ) {
    lastEmitted.current = propViewState;
    store.setState({ viewState: propViewState });
  }

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
  const data: HostData = {
    tree: props.tree,
    taxonomy: props.taxonomy,
    msa: props.msa,
    geneMetadata: props.geneMetadata,
    nodeAnnotations: props.nodeAnnotations,
    labelProviders: props.labelProviders,
    proteinDomains: props.proteinDomains,
    exonJunctions: props.exonJunctions,
  };

  return (
    <div
      className={`tbrowse-root tbrowse-theme-${props.theme ?? 'light'} ${props.className ?? ''}`}
      style={{ width: '100%', height: '100%' }}
    >
      <Layout data={data} zones={props.zones} />
    </div>
  );
}
