import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TBrowse,
  fromEnsemblGeneTree,
  labelsZone,
  msaZone,
  treeZone,
  type FromEnsemblResult,
  type ViewState,
} from 'tbrowse';
import {
  largeSampleTree,
  sampleGeneMetadata,
  sampleGoProvider,
  sampleMSA,
  sampleTaxonomy,
  sampleTree,
} from './sampleTree';

const ENSEMBL_URL =
  'https://rest.ensembl.org/genetree/id/ENSGT00390000003602?aligned=1&sequence=protein';

function buildInitialViewState(zoneIds: string[]): ViewState {
  return {
    selectedNodeId: null,
    collapsedNodeIds: [],
    prunedNodeIds: [],
    swappedNodeIds: [],
    zones: zoneIds.map((id, i) => ({
      id,
      width: [280, 220, 360][i] ?? 200,
      visible: true,
    })),
    zoneStates: {},
    search: null,
  };
}

type DataSource = 'sample' | 'ensembl';

function App() {
  const zones = useMemo(() => [treeZone, labelsZone, msaZone], []);
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const [tree, setTree] = useState(sampleTree);
  const [viewState, setViewState] = useState<ViewState>(() => buildInitialViewState(zoneIds));

  const [dataSource, setDataSource] = useState<DataSource>('sample');
  const [ensemblData, setEnsemblData] = useState<FromEnsemblResult | null>(null);
  const [ensemblStatus, setEnsemblStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ensemblError, setEnsemblError] = useState<string | null>(null);

  const loadEnsembl = async () => {
    if (ensemblData) {
      setDataSource('ensembl');
      setViewState(buildInitialViewState(zoneIds));
      return;
    }
    setEnsemblStatus('loading');
    setEnsemblError(null);
    try {
      const res = await fetch(ENSEMBL_URL, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      const data = fromEnsemblGeneTree(json);
      setEnsemblData(data);
      setDataSource('ensembl');
      setViewState(buildInitialViewState(zoneIds));
      setEnsemblStatus('idle');
    } catch (err) {
      setEnsemblError(err instanceof Error ? err.message : String(err));
      setEnsemblStatus('error');
    }
  };

  const switchToSample = () => {
    setDataSource('sample');
    setViewState(buildInitialViewState(zoneIds));
  };

  const setCollapsed = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, collapsedNodeIds: ids }));
  const setPruned = (ids: string[]) =>
    setViewState((vs) => ({ ...vs, prunedNodeIds: ids }));
  const reset = () => setViewState(buildInitialViewState(zoneIds));

  const dataProps =
    dataSource === 'sample' || !ensemblData
      ? {
          tree,
          taxonomy: sampleTaxonomy,
          geneMetadata: sampleGeneMetadata,
          msa: sampleMSA,
          labelProviders: [sampleGoProvider],
        }
      : {
          tree: ensemblData.tree,
          taxonomy: ensemblData.taxonomy,
          geneMetadata: ensemblData.geneMetadata,
          msa: ensemblData.msa,
          labelProviders: undefined,
        };

  const stats =
    dataSource === 'ensembl' && ensemblData
      ? {
          nodes: Object.keys(ensemblData.tree.nodes).length,
          leaves: Object.values(ensemblData.tree.nodes).filter((n) => n.isLeaf).length,
          taxa: Object.keys(ensemblData.taxonomy).length,
          msaLength: ensemblData.msa?.length ?? 0,
        }
      : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="panel" style={{ padding: 12, borderBottom: '1px solid #ddd' }}>
        <strong style={{ marginRight: 12 }}>tbrowse playground</strong>
        <span style={{ marginRight: 12, color: '#666', fontSize: 12 }}>data:</span>
        <button
          onClick={switchToSample}
          disabled={dataSource === 'sample'}
          style={{ marginRight: 4 }}
        >
          Sample
        </button>
        <button
          onClick={loadEnsembl}
          disabled={dataSource === 'ensembl' || ensemblStatus === 'loading'}
        >
          {ensemblStatus === 'loading'
            ? 'Loading…'
            : ensemblData
              ? 'Ensembl (cached)'
              : 'Load Ensembl tree'}
        </button>
        <span style={{ marginLeft: 12 }}>
          <button onClick={reset}>reset</button>
          {dataSource === 'sample' && (
            <>
              <button onClick={() => setCollapsed(['n1'])}>collapse n1</button>
              <button onClick={() => setCollapsed(['n3'])}>collapse n3</button>
              <button onClick={() => setPruned(['n1'])}>prune n1</button>
              <button onClick={() => setPruned(['n4'])}>prune n4</button>
              <button
                onClick={() => setTree((t) => (t === sampleTree ? largeSampleTree : sampleTree))}
              >
                toggle tree size
              </button>
            </>
          )}
        </span>
        <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
          selected: {viewState.selectedNodeId ?? '—'}
        </span>
        {stats && (
          <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
            ensembl: {stats.leaves} leaves · {stats.nodes} nodes · {stats.taxa} taxa ·
            MSA {stats.msaLength} cols
          </span>
        )}
        {ensemblError && (
          <span style={{ marginLeft: 12, color: '#c0392b', fontSize: 12 }}>
            error: {ensemblError}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TBrowse
          {...dataProps}
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
