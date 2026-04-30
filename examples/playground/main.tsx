import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TBrowse,
  computePivotState,
  fromEnsemblGeneTree,
  fromEnsemblProteinFeatures,
  fromGrameneGene,
  fromGrameneGenetree,
  labelsZone,
  msaZone,
  treeZone,
  type FromEnsemblResult,
  type FromGrameneGenetreeResult,
  type PrunedNodeStyle,
  type ProteinDomain,
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
  sampleProteinDomains,
  sampleTaxonomy,
  sampleTree,
} from './sampleTree';

const ENSEMBL_GENE_OF_INTEREST = 'ENSG00000139618'; // BRCA2 (human)
const ENSEMBL_URL = `https://rest.ensembl.org/genetree/member/id/homo_sapiens/${ENSEMBL_GENE_OF_INTEREST}?aligned=1&sequence=protein`;

// Initial fr-share per zone id. The chassis treats zone widths as
// fractions of the container so this gives tree 30 % / labels 20 % /
// MSA 50 %.
const INITIAL_ZONE_FR: Record<string, number> = {
  tree: 30,
  labels: 20,
  msa: 50,
};

function buildInitialViewState(zoneIds: string[]): ViewState {
  return {
    selectedNodeId: null,
    collapsedNodeIds: [],
    prunedNodeIds: [],
    swappedNodeIds: [],
    compressedNodeIds: [],
    nodeOfInterestId: null,
    zones: zoneIds.map((id) => ({
      id,
      width: INITIAL_ZONE_FR[id] ?? 25,
      visible: true,
    })),
    zoneStates: {},
    search: null,
  };
}

type DataSource = 'sample' | 'ensembl' | 'gramene';

const GRAMENE_DEFAULT_GENE = 'AT1G01040';
const GRAMENE_BASE = 'https://data.gramene.org/v69';

function App() {
  const zones = useMemo(() => [treeZone, labelsZone, msaZone], []);
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const [tree, setTree] = useState(sampleTree);
  const [viewState, setViewState] = useState<ViewState>(() => buildInitialViewState(zoneIds));

  const [dataSource, setDataSource] = useState<DataSource>('sample');
  const [ensemblData, setEnsemblData] = useState<FromEnsemblResult | null>(null);
  const [ensemblStatus, setEnsemblStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ensemblError, setEnsemblError] = useState<string | null>(null);
  const [ensemblDomains, setEnsemblDomains] = useState<
    Record<string, ProteinDomain[]> | null
  >(null);
  const [domainStatus, setDomainStatus] = useState<{
    state: 'idle' | 'loading' | 'error';
    done?: number;
    total?: number;
    error?: string;
  }>({ state: 'idle' });

  const [grameneGeneInput, setGrameneGeneInput] = useState(GRAMENE_DEFAULT_GENE);
  const [grameneData, setGrameneData] = useState<FromGrameneGenetreeResult | null>(null);
  const [grameneStatus, setGrameneStatus] = useState<{
    state: 'idle' | 'loading' | 'error';
    error?: string;
  }>({ state: 'idle' });

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

  /**
   * Fan out to /overlap/translation/{ENSP}?feature=protein_feature for
   * every leaf with a known translation id, with a small concurrency cap
   * so we don't slam the Ensembl REST API. Each response is shoved through
   * `fromEnsemblProteinFeatures` (the pure converter) and accumulated by
   * GeneId, so the network code stays in the host and the package only
   * sees normalized data.
   */
  const loadEnsemblDomains = async () => {
    if (!ensemblData) return;
    if (ensemblDomains) return;
    const entries = Object.entries(ensemblData.proteinIdByGeneId);
    if (entries.length === 0) {
      setDomainStatus({ state: 'error', error: 'No protein ids on this tree' });
      return;
    }
    setDomainStatus({ state: 'loading', done: 0, total: entries.length });
    const result: Record<string, ProteinDomain[]> = {};
    let done = 0;
    let aborted = false;
    const concurrency = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length && !aborted) {
        const idx = cursor++;
        const [geneId, ensp] = entries[idx];
        try {
          const res = await fetch(
            `https://rest.ensembl.org/overlap/translation/${ensp}?feature=protein_feature`,
            { headers: { Accept: 'application/json' } },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${ensp}`);
          const json = (await res.json()) as unknown;
          // Filter to Pfam + Smart for v1; users can broaden by editing
          // this option list. Drop the option to keep every source.
          result[geneId] = fromEnsemblProteinFeatures(json, {
            sources: ['Pfam', 'Smart'],
          });
        } catch (err) {
          aborted = true;
          setDomainStatus({
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        done++;
        setDomainStatus({ state: 'loading', done, total: entries.length });
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    if (aborted) return;
    setEnsemblDomains(result);
    setDomainStatus({ state: 'idle', done, total: entries.length });
  };

  /**
   * Two-step Gramene fetch:
   *  1) /genes?idList=<gene>  → read homology.gene_tree.id
   *  2) /genetrees?idList=<treeId>  → tree + MSA + per-leaf domain hits
   * The genetree response already contains the per-leaf protein domains
   * with residue ranges, so there's no fan-out — one HTTP call beyond the
   * gene lookup is enough.
   */
  const loadGramene = async (geneId: string) => {
    setGrameneStatus({ state: 'loading' });
    try {
      const geneRes = await fetch(
        `${GRAMENE_BASE}/genes?idList=${encodeURIComponent(geneId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!geneRes.ok) throw new Error(`HTTP ${geneRes.status} on /genes`);
      const geneJson = (await geneRes.json()) as unknown;
      const gene = fromGrameneGene(geneJson);
      if (!gene.geneTreeId) {
        throw new Error(`Gene ${gene.geneId} has no gene tree assigned`);
      }
      const treeRes = await fetch(
        `${GRAMENE_BASE}/genetrees?idList=${encodeURIComponent(gene.geneTreeId)}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!treeRes.ok) throw new Error(`HTTP ${treeRes.status} on /genetrees`);
      const treeJson = (await treeRes.json()) as unknown;
      const data = fromGrameneGenetree(treeJson);
      setGrameneData(data);
      setDataSource('gramene');
      // Center on the originating gene so the user lands looking at it.
      const initial = buildInitialViewState(zoneIds);
      const pivot = computePivotState(data.tree, gene.geneId);
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
      setGrameneStatus({ state: 'idle' });
    } catch (err) {
      setGrameneStatus({
        state: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
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
    const treeForPivot =
      dataSource === 'sample'
        ? tree
        : dataSource === 'ensembl'
          ? ensemblData?.tree
          : grameneData?.tree;
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
    dataSource === 'gramene' && grameneData
      ? {
          tree: grameneData.tree,
          taxonomy: grameneData.taxonomy,
          geneMetadata: grameneData.geneMetadata,
          msa: grameneData.msa,
          proteinDomains: grameneData.proteinDomains,
          labelProviders: undefined,
        }
      : dataSource === 'ensembl' && ensemblData
        ? {
            tree: ensemblData.tree,
            taxonomy: ensemblData.taxonomy,
            geneMetadata: ensemblData.geneMetadata,
            msa: ensemblData.msa,
            proteinDomains: ensemblDomains ?? undefined,
            labelProviders: undefined,
          }
        : {
            tree,
            taxonomy: sampleTaxonomy,
            geneMetadata: sampleGeneMetadata,
            msa: sampleMSA,
            proteinDomains: sampleProteinDomains,
            labelProviders: [sampleGoProvider],
          };

  const statsTree =
    dataSource === 'ensembl' && ensemblData
      ? ensemblData
      : dataSource === 'gramene' && grameneData
        ? grameneData
        : null;
  const stats = statsTree
    ? {
        source: dataSource,
        nodes: Object.keys(statsTree.tree.nodes).length,
        leaves: Object.values(statsTree.tree.nodes).filter((n) => n.isLeaf).length,
        taxa: Object.keys(statsTree.taxonomy).length,
        msaLength: statsTree.msa?.length ?? 0,
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
        {dataSource === 'ensembl' && ensemblData && (
          <button
            onClick={loadEnsemblDomains}
            disabled={
              !!ensemblDomains || domainStatus.state === 'loading'
            }
            style={{ marginLeft: 4 }}
            title="Fan out to /overlap/translation/{ENSP} for each leaf and feed through fromEnsemblProteinFeatures."
          >
            {domainStatus.state === 'loading'
              ? `Loading domains ${domainStatus.done ?? 0}/${domainStatus.total ?? 0}…`
              : ensemblDomains
                ? 'Pfam domains (cached)'
                : 'Load Pfam domains'}
          </button>
        )}
        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={grameneGeneInput}
            onChange={(e) => setGrameneGeneInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && grameneGeneInput.trim()) {
                loadGramene(grameneGeneInput.trim());
              }
            }}
            placeholder="Gramene gene id"
            style={{ width: 140, fontSize: 12 }}
            disabled={grameneStatus.state === 'loading'}
          />
          <button
            onClick={() => loadGramene(grameneGeneInput.trim())}
            disabled={grameneStatus.state === 'loading' || !grameneGeneInput.trim()}
            title="Two-step Gramene fetch: /genes → /genetrees, all per-leaf MSA + domain hits in one tree call."
          >
            {grameneStatus.state === 'loading' ? 'Loading…' : 'Load Gramene'}
          </button>
        </span>
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
            {stats.source}: {stats.leaves} leaves · {stats.nodes} nodes · {stats.taxa} taxa ·
            MSA {stats.msaLength} cols
          </span>
        )}
        {domainStatus.state === 'error' && (
          <span style={{ marginLeft: 12, color: '#c0392b', fontSize: 12 }}>
            domains error: {domainStatus.error}
          </span>
        )}
        {grameneStatus.state === 'error' && (
          <span style={{ marginLeft: 12, color: '#c0392b', fontSize: 12 }}>
            gramene error: {grameneStatus.error}
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
