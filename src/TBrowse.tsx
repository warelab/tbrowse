import { useEffect, useMemo, useRef } from 'react';
import { createTBrowseStore, TBrowseStoreProvider } from './store';
import { Layout } from './layout/Layout';
import type { HostData, TBrowseProps } from './types';

export function TBrowse(props: TBrowseProps) {
  const store = useMemo(() => createTBrowseStore(props), []);

  const propViewState = props.viewState;
  const onChange = props.onViewStateChange;
  const isControlled = propViewState !== undefined;

  useEffect(() => {
    if (isControlled && propViewState) {
      store.setState({ viewState: propViewState });
    }
  }, [isControlled, propViewState, store]);

  const lastEmitted = useRef(store.getState().viewState);
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
