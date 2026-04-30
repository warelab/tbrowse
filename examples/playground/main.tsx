import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TBrowse,
  computePivotState,
  fromEnsemblGeneTree,
  labelsZone,
  msaZone,
  treeZone,
  type FromEnsemblResult,
  type PrunedNodeStyle,
  type ViewState,
} from 'tbrowse';

const PRUNED_STYLES: { id: PrunedNodeStyle; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'triangle', label: 'Triangle (default)' },
  { id: 'cap', label: 'Cap (⊣ cut-stub)' },
  { id: 'slash', label: 'Slash (suppressed)' },
  { id: 'scissors', label: 'Scissors (cut mark)' },
  { id: 'ellipsis', label: 'Ellipsis (…)' },
  { id: 'ghost', label: 'Ghost (faint)' },
  { id: 'minitree', label: 'Mini subtree' },
  { id: 'count', label: 'Count badge' },
  { id: 'broken', label: 'Broken branch' },
  { id: 'bracket', label: 'Bracket (])' },
];
import {
  largeSampleTree,
  sampleGeneMetadata,
  sampleGoProvider,
  sampleMSA,
  sampleTaxonomy,
  sampleTree,
} from './sampleTree';

const ENSEMBL_GENE_OF_INTEREST = 'ENSG00000139618'; // BRCA2 (human)
const ENSEMBL_URL = `https://rest.ensembl.org/genetree/member/id/homo_sapiens/${ENSEMBL_GENE_OF_INTEREST}?aligned=1&sequence=protein`;

function buildInitialViewState(zoneIds: string[]): ViewState {
  return {
    selectedNodeId: null,
    collapsedNodeIds: [],
    prunedNodeIds: [],
    swappedNodeIds: [],
    nodeOfInterestId: null,
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

  const applyEnsemblViewState = (data: FromEnsemblResult) => {
    const pivot = computePivotState(data.tree, ENSEMBL_GENE_OF_INTEREST);
    const initial = buildInitialViewState(zoneIds);
    setViewState(
      pivot
        ? {
            ...initial,
            collapsedNodeIds: pivot.collapsedNodeIds,
            swappedNodeIds: pivot.swappedNodeIds,
            nodeOfInterestId: pivot.targetId,
          }
        : initial,
    );
  };

  const loadEnsembl = async () => {
    if (ensemblData) {
      setDataSource('ensembl');
      applyEnsemblViewState(ensemblData);
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
      applyEnsemblViewState(data);
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

  const prunedStyle =
    ((viewState.zoneStates.tree as { prunedNodeStyle?: PrunedNodeStyle } | undefined)
      ?.prunedNodeStyle) ?? 'triangle';
  const setPrunedStyle = (next: PrunedNodeStyle) =>
    setViewState((vs) => ({
      ...vs,
      zoneStates: {
        ...vs.zoneStates,
        tree: { ...(vs.zoneStates.tree ?? {}), prunedNodeStyle: next },
      },
    }));

  const pivotTo = (identifier: string) => {
    const treeForPivot = dataSource === 'sample' ? tree : ensemblData?.tree;
    if (!treeForPivot) return;
    const pivot = computePivotState(treeForPivot, identifier);
    if (!pivot) return;
    setViewState((vs) => ({
      ...buildInitialViewState(zoneIds),
      collapsedNodeIds: pivot.collapsedNodeIds,
      swappedNodeIds: pivot.swappedNodeIds,
      nodeOfInterestId: pivot.targetId,
      zones: vs.zones,
      zoneStates: vs.zoneStates,
    }));
  };

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
              <button onClick={() => pivotTo('ENSG00000000001')}>pivot to Human</button>
              <button onClick={() => pivotTo('ENSDARG00000001')}>pivot to Zebrafish</button>
              <button
                onClick={() => setTree((t) => (t === sampleTree ? largeSampleTree : sampleTree))}
              >
                toggle tree size
              </button>
            </>
          )}
        </span>
        <span style={{ marginLeft: 16, color: '#666', fontSize: 12 }}>
          pruned-mark:&nbsp;
          <select
            value={prunedStyle}
            onChange={(e) => setPrunedStyle(e.target.value as PrunedNodeStyle)}
          >
            {PRUNED_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
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
          nodeOfInterest={dataSource === 'ensembl' ? ENSEMBL_GENE_OF_INTEREST : undefined}
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
