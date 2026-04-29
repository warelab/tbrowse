import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TBrowse, createStubZone, type ViewState } from 'tbrowse';
import { largeSampleTree, sampleTaxonomy, sampleTree } from './sampleTree';

function buildInitialViewState(zoneIds: string[]): ViewState {
  return {
    selectedNodeId: null,
    collapsedNodeIds: [],
    prunedNodeIds: [],
    zones: zoneIds.map((id, i) => ({
      id,
      width: [240, 200, 320][i] ?? 200,
      visible: true,
    })),
    zoneStates: {},
    search: null,
  };
}

function App() {
  const zones = useMemo(
    () => [
      createStubZone({ id: 'tree-stub', displayName: 'Tree (stub)', defaultWidth: 240 }),
      createStubZone({ id: 'labels-stub', displayName: 'Labels (stub)', defaultWidth: 200 }),
      createStubZone({
        id: 'msa-stub',
        displayName: 'MSA (stub)',
        defaultWidth: 320,
        contentWidth: 1400,
      }),
    ],
    [],
  );
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const [tree, setTree] = useState(sampleTree);
  const [viewState, setViewState] = useState<ViewState>(() => buildInitialViewState(zoneIds));

  const setCollapsed = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, collapsedNodeIds: ids }));
  const setPruned = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, prunedNodeIds: ids }));
  const reset = () => setViewState(buildInitialViewState(zoneIds));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="panel" style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
        <strong style={{ marginRight: 12 }}>tbrowse layout milestone</strong>
        <button onClick={reset}>reset</button>
        <button onClick={() => setCollapsed(['n1'])}>collapse n1</button>
        <button onClick={() => setCollapsed(['n3'])}>collapse n3</button>
        <button onClick={() => setPruned(['n1'])}>prune n1</button>
        <button onClick={() => setPruned(['n4'])}>prune n4</button>
        <button onClick={() => setTree((t) => (t === sampleTree ? largeSampleTree : sampleTree))}>
          toggle tree size
        </button>
        <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
          selected: {viewState.selectedNodeId ?? '—'}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TBrowse
          tree={tree}
          taxonomy={sampleTaxonomy}
          zones={zones}
          viewState={viewState}
          onViewStateChange={setViewState}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
