import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TBrowse, type ViewState } from 'tbrowse';
import { sampleTree, sampleTaxonomy } from './sampleTree';

const initialViewState: ViewState = {
  selectedNodeId: null,
  collapsedNodeIds: [],
  prunedNodeIds: [],
  zones: [],
  labels: { visibleFields: [] },
  search: null,
};

function App() {
  const [viewState, setViewState] = useState<ViewState>(initialViewState);

  const setCollapsed = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, collapsedNodeIds: ids }));
  const setPruned = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, prunedNodeIds: ids }));

  return (
    <div className="layout">
      <div className="panel">
        <h1>Controls</h1>
        <p>Sample tree: 8 nodes, 5 leaves.</p>
        <button onClick={() => setViewState(initialViewState)}>reset</button>
        <button onClick={() => setCollapsed(['n1'])}>collapse n1 (mammals)</button>
        <button onClick={() => setCollapsed(['n3'])}>collapse n3 (primates)</button>
        <button onClick={() => setPruned(['n1'])}>prune n1 (mammals)</button>
        <button onClick={() => setPruned(['n4'])}>prune n4 (human leaf)</button>
        <h1 style={{ marginTop: 16 }}>viewState</h1>
        <pre style={{ fontSize: 12 }}>{JSON.stringify(viewState, null, 2)}</pre>
      </div>
      <div className="panel">
        <h1>computeVisibleRows output</h1>
        <TBrowse
          tree={sampleTree}
          taxonomy={sampleTaxonomy}
          zones={[]}
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
