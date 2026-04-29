import { useEffect, useMemo, useRef } from 'react';
import { createTBrowseStore, TBrowseStoreProvider, useTBrowseStore } from './store';
import { computeVisibleRows } from './visibleRows';
import type { TBrowseProps } from './types';

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
  const collapsed = useTBrowseStore((s) => s.viewState.collapsedNodeIds);
  const pruned = useTBrowseStore((s) => s.viewState.prunedNodeIds);

  const rows = useMemo(
    () =>
      computeVisibleRows({
        tree: props.tree,
        collapsedNodeIds: new Set(collapsed),
        prunedNodeIds: new Set(pruned),
      }),
    [props.tree, collapsed, pruned],
  );

  return (
    <div className={`tbrowse-root tbrowse-theme-${props.theme ?? 'light'} ${props.className ?? ''}`}>
      <div data-rows={rows.length}>
        {/* Layout, zones, virtualization — not yet implemented. */}
        {/* For the first milestone the visible-rows derivation is exposed for inspection. */}
        <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(rows, null, 2)}</pre>
      </div>
    </div>
  );
}
