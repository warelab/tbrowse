import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  TBrowse,
  computePivotState,
  createGenomeZone,
  createTableZone,
  type ZoneDefinition,
  fromEnsemblGeneTree,
  fromEnsemblProteinFeatures,
  fromGrameneGene,
  fromGrameneGenetree,
  fromGrameneGeneStructures,
  fromGrameneNeighborhood,
  labelsZone,
  msaZone,
  neighborhoodZone,
  treeZone,
  type FromEnsemblResult,
  type FromGrameneGenetreeResult,
  type GeneStructure,
  type Neighborhood,
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
  sampleExpressionColumns,
  sampleExpressionTable,
  sampleGeneMetadata,
  sampleGeneStructures,
  sampleGenomeFeatures,
  sampleGoProvider,
  sampleMSA,
  sampleProteinDomains,
  sampleScoreColumns,
  sampleScoreTable,
  sampleTaxonomy,
  sampleTree,
} from './sampleTree';
import { parseTableFile } from './parseTableFile';

const ENSEMBL_GENE_OF_INTEREST = 'ENSG00000139618'; // BRCA2 (human)
const ENSEMBL_URL = `https://rest.ensembl.org/genetree/member/id/homo_sapiens/${ENSEMBL_GENE_OF_INTEREST}?aligned=1&sequence=protein`;

// Initial fr-share per zone id. The chassis treats zone widths as
// fractions of the container so this gives tree 30 % / labels 20 % /
// MSA 50 %.
const INITIAL_ZONE_FR: Record<string, number> = {
  tree: 18,
  labels: 10,
  msa: 28,
  neighborhood: 22,
  'genome-canonical': 24,
  'table-expression': 12,
  'table-scores': 10,
};

/**
 * URL-hash round-tripping for the playground's full state — the data
 * source (sample / ensembl / gramene), any source-specific selector
 * (currently only Gramene's gene-id input), and the TBrowse `viewState`
 * prop. Encoded as `#<percent-encoded JSON>` with `history.replaceState`
 * so the back button stays uncluttered. A page reload rehydrates the
 * data source (re-fetching Gramene if needed), then re-applies the
 * stored viewState — collapsed/pruned subtrees, NoI, MSA viewport,
 * label fields, search, zone widths/order, and per-zone state.
 */
interface UrlState {
  source?: DataSource;
  /** Gene id used to load the Gramene tree — only meaningful when
   *  source === 'gramene'. */
  grameneGeneId?: string;
  viewState?: Partial<ViewState>;
}

function decodeUrlState(): UrlState | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash;
  if (!h || h.length < 2) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(h.slice(1))) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as UrlState;
  } catch {
    // Malformed hash — silently ignore so the user lands on a fresh view
    // rather than a blank screen.
  }
  return null;
}

function encodeUrlState(s: UrlState): string {
  return '#' + encodeURIComponent(JSON.stringify(s));
}

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

/** Mount-time helper: prefers viewState encoded in the URL hash, falls
 *  back to a fresh `buildInitialViewState`. Only used at first render —
 *  the app's reset / data-source-switch paths build fresh state. */
function buildBootstrapViewState(zoneIds: string[]): ViewState {
  const url = decodeUrlState();
  const base = buildInitialViewState(zoneIds);
  return url?.viewState ? { ...base, ...url.viewState } : base;
}

type DataSource = 'sample' | 'ensembl' | 'gramene';

const GRAMENE_DEFAULT_GENE = 'SORBI_3006G095600';
const GRAMENE_BASE = 'https://data.gramene.org/v69';

function App() {
  const expressionZone = useMemo(
    () =>
      createTableZone({
        id: 'table-expression',
        defaultName: 'Expression',
        table: sampleExpressionTable,
        columns: sampleExpressionColumns,
        defaultWidth: 12,
        minWidth: 140,
      }),
    [],
  );
  const scoresZone = useMemo(
    () =>
      createTableZone({
        id: 'table-scores',
        defaultName: 'Scores',
        table: sampleScoreTable,
        columns: sampleScoreColumns,
        defaultWidth: 10,
        minWidth: 120,
      }),
    [],
  );
  const genomeZone = useMemo(
    () =>
      createGenomeZone({
        id: 'genome-canonical',
        displayName: 'Gene structure',
        defaultWidth: 24,
      }),
    [],
  );
  const [uploadedZones, setUploadedZones] = useState<ZoneDefinition[]>([]);
  const [uploadStatus, setUploadStatus] = useState<{
    state: 'idle' | 'error';
    message?: string;
  }>({ state: 'idle' });
  const zones = useMemo(
    () => [
      treeZone,
      labelsZone,
      msaZone,
      neighborhoodZone,
      genomeZone,
      expressionZone,
      scoresZone,
      ...uploadedZones,
    ],
    [genomeZone, expressionZone, scoresZone, uploadedZones],
  );
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones]);

  const [tree, setTree] = useState(sampleTree);
  const [viewState, setViewState] = useState<ViewState>(() => buildBootstrapViewState(zoneIds));

  const bootstrappedUrl = useMemo(() => decodeUrlState(), []);

  const [dataSource, setDataSource] = useState<DataSource>(
    bootstrappedUrl?.source ?? 'sample',
  );
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

  const [grameneGeneInput, setGrameneGeneInput] = useState(
    bootstrappedUrl?.source === 'gramene' && bootstrappedUrl.grameneGeneId
      ? bootstrappedUrl.grameneGeneId
      : GRAMENE_DEFAULT_GENE,
  );
  const [grameneData, setGrameneData] = useState<FromGrameneGenetreeResult | null>(null);
  const [grameneNeighborhood, setGrameneNeighborhood] = useState<
    Record<string, Neighborhood> | null
  >(null);
  const [grameneGeneStructures, setGrameneGeneStructures] = useState<
    Record<string, GeneStructure> | null
  >(null);
  const [grameneStatus, setGrameneStatus] = useState<{
    state: 'idle' | 'loading' | 'error';
    error?: string;
  }>({ state: 'idle' });

  const [theme, setTheme] = useState<'light' | 'dark'>('light');

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
  /**
   * Fetch +/-10 flanking genes around every leaf in the named tree via
   * the Gramene Solr graph query, then convert via
   * `fromGrameneNeighborhood` and stash on state. Errors are logged
   * and otherwise non-fatal — the rest of the view still works without
   * neighbourhood data.
   */
  const loadGrameneNeighborhood = async (treeId: string) => {
    try {
      const url = new URL(`${GRAMENE_BASE}/search`);
      url.searchParams.set(
        'fl',
        'id,name,gene_tree,gene_idx,region,start,end,strand,biotype,system_name,description',
      );
      url.searchParams.set(
        'fq',
        `{!graph from=compara_neighbors_10 to=compara_idx_multi maxDepth=1}gene_tree:${treeId}`,
      );
      url.searchParams.set('rows', '100000');
      url.searchParams.set('start', '0');
      const res = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} on /search`);
      const json = (await res.json()) as unknown;
      const map = fromGrameneNeighborhood(json);
      setGrameneNeighborhood(map);
    } catch (err) {
      // Non-fatal: surface to the console so the user can debug, but
      // keep the rest of the playground working.
      // eslint-disable-next-line no-console
      console.warn('Neighborhood fetch failed:', err);
    }
  };

  /**
   * Fetch `gene_structure` (+ `location` + `name`) for every leaf in the
   * tree, in chunks so the URL stays under typical proxy limits, and
   * convert via `fromGrameneGeneStructures`. Errors are logged but
   * non-fatal — the rest of the view keeps working without gene
   * structures.
   */
  const loadGrameneGeneStructures = async (geneIds: string[]) => {
    try {
      const CHUNK = 200;
      const accumulated: Record<string, GeneStructure> = {};
      for (let i = 0; i < geneIds.length; i += CHUNK) {
        const slice = geneIds.slice(i, i + CHUNK);
        const url = new URL(`${GRAMENE_BASE}/genes`);
        url.searchParams.set('rows', '-1');
        url.searchParams.set(
          'fl',
          '_id,name,location,gene_structure,canonical_transcript',
        );
        url.searchParams.set('idList', slice.join(','));
        const res = await fetch(url.toString(), {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} on /genes`);
        const json = (await res.json()) as unknown;
        const map = fromGrameneGeneStructures(json);
        for (const k of Object.keys(map)) accumulated[k] = map[k];
      }
      setGrameneGeneStructures(accumulated);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Gene-structure fetch failed:', err);
    }
  };

  /** Track which Gramene gene is currently loaded so the URL hash can
   *  reflect it. Set on success, cleared when the user switches away. */
  const [loadedGrameneGeneId, setLoadedGrameneGeneId] = useState<string | null>(
    null,
  );

  const loadGramene = async (
    geneId: string,
    opts: { applyPivot?: boolean } = {},
  ) => {
    const applyPivot = opts.applyPivot ?? true;
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
      // Reset any cached neighborhood from a previous tree, then kick
      // off the (potentially large) Solr graph fetch in the background.
      setGrameneNeighborhood(null);
      void loadGrameneNeighborhood(gene.geneTreeId);
      // Same pattern for gene structures: fan out to /genes for every
      // leaf, in chunks. Runs concurrently with the neighborhood fetch.
      setGrameneGeneStructures(null);
      const leafIds = Object.values(data.tree.nodes)
        .filter((n) => n.isLeaf && typeof n.geneId === 'string')
        .map((n) => n.geneId as string);
      if (leafIds.length > 0) {
        void loadGrameneGeneStructures(leafIds);
      }
      setDataSource('gramene');
      setLoadedGrameneGeneId(gene.geneId);
      if (applyPivot) {
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
      }
      // When applyPivot is false, the URL-restored viewState that was
      // applied at mount stays untouched — collapsed/pruned/NoI/etc.
      // resolve against the just-loaded tree.
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
    setLoadedGrameneGeneId(null);
    setViewState(buildInitialViewState(zoneIds));
  };

  // On mount, if the URL hash says we should be looking at a Gramene
  // gene, kick off the load with `applyPivot: false` so the URL's
  // viewState (already restored by buildBootstrapViewState) wins. The
  // ref guard prevents StrictMode's double-mount from firing twice.
  const bootstrappedRef = useRef(false);
  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    if (
      bootstrappedUrl?.source === 'gramene' &&
      bootstrappedUrl.grameneGeneId
    ) {
      void loadGramene(bootstrappedUrl.grameneGeneId, { applyPivot: false });
    }
  }, [bootstrappedUrl]);

  // Mirror data source + Gramene gene + viewState into the URL hash so
  // the playground state is shareable. `replaceState` keeps the back
  // button uncluttered.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const next = encodeUrlState({
      source: dataSource,
      grameneGeneId: loadedGrameneGeneId ?? undefined,
      viewState,
    });
    if (window.location.hash !== next) {
      const url =
        window.location.pathname + window.location.search + next;
      window.history.replaceState(null, '', url);
    }
  }, [dataSource, loadedGrameneGeneId, viewState]);

  const handleUploadedFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadStatus({ state: 'idle' });
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        const parsed = parseTableFile(text);
        if (parsed.columns.length === 0 || parsed.rowCount === 0) {
          setUploadStatus({
            state: 'error',
            message: `${file.name}: ${parsed.warnings.join('; ') || 'no data rows'}`,
          });
          continue;
        }
        const stem = file.name.replace(/\.[^.]+$/, '');
        const id = `upload-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const zone = createTableZone({
          id,
          defaultName: stem,
          table: parsed.table,
          columns: parsed.columns,
          defaultWidth: 14,
          minWidth: 140,
        });
        setUploadedZones((prev) => [...prev, zone]);
        // Append zoneState entry so the chassis lays the new zone out
        // immediately instead of waiting for an interaction.
        setViewState((vs) => ({
          ...vs,
          zones: [
            ...vs.zones,
            { id, width: zone.defaultWidth, visible: true },
          ],
        }));
        if (parsed.warnings.length > 0) {
          setUploadStatus({
            state: 'error',
            message: `${file.name}: ${parsed.warnings.join('; ')}`,
          });
        }
      } catch (err) {
        setUploadStatus({
          state: 'error',
          message: `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
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
          exonJunctions: grameneData.exonJunctions,
          neighborhood: grameneNeighborhood ?? undefined,
          geneStructures: grameneGeneStructures ?? undefined,
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
            geneStructures: sampleGeneStructures,
            genomeFeatures: sampleGenomeFeatures,
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
    <div
      // Wrap in tbrowse-root + tbrowse-theme-* so the toolbar and panel
      // pick up the same CSS vars TBrowse uses, and the page background
      // flips with the theme toggle.
      className={`tbrowse-root tbrowse-theme-${theme}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <div
        className="panel"
        style={{
          borderBottom: '1px solid var(--tbrowse-divider)',
          background: 'var(--tbrowse-bg-strip)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 1 — Sample tree + sample-only operations */}
        <ToolbarRow label="Sample">
          <button
            onClick={switchToSample}
            disabled={dataSource === 'sample'}
          >
            Sample
          </button>
          <button
            onClick={() => setCollapsed(['n1'])}
            disabled={dataSource !== 'sample'}
          >
            collapse n1
          </button>
          <button
            onClick={() => setCollapsed(['n3'])}
            disabled={dataSource !== 'sample'}
          >
            collapse n3
          </button>
          <button
            onClick={() => setPruned(['n1'])}
            disabled={dataSource !== 'sample'}
          >
            prune n1
          </button>
          <button
            onClick={() => setPruned(['n4'])}
            disabled={dataSource !== 'sample'}
          >
            prune n4
          </button>
          <button
            onClick={() => pivotTo('ENSG00000000001')}
            disabled={dataSource !== 'sample'}
          >
            pivot to Human
          </button>
          <button
            onClick={() => pivotTo('ENSDARG00000001')}
            disabled={dataSource !== 'sample'}
          >
            pivot to Zebrafish
          </button>
          <button
            onClick={() => setTree((t) => (t === sampleTree ? largeSampleTree : sampleTree))}
            disabled={dataSource !== 'sample'}
          >
            toggle tree size
          </button>
        </ToolbarRow>

        {/* 2 — Ensembl tree + Pfam domains fan-out */}
        <ToolbarRow label="Ensembl">
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
          <button
            onClick={loadEnsemblDomains}
            disabled={
              dataSource !== 'ensembl' ||
              !ensemblData ||
              !!ensemblDomains ||
              domainStatus.state === 'loading'
            }
            title="Fan out to /overlap/translation/{ENSP} for each leaf and feed through fromEnsemblProteinFeatures."
          >
            {domainStatus.state === 'loading'
              ? `Loading domains ${domainStatus.done ?? 0}/${domainStatus.total ?? 0}…`
              : ensemblDomains
                ? 'Pfam domains (cached)'
                : 'Load Pfam domains'}
          </button>
          {domainStatus.state === 'error' && (
            <span style={{ color: '#c0392b', fontSize: 12 }}>
              domains error: {domainStatus.error}
            </span>
          )}
          {ensemblError && (
            <span style={{ color: '#c0392b', fontSize: 12 }}>
              error: {ensemblError}
            </span>
          )}
        </ToolbarRow>

        {/* 3 — Gramene tree + user data uploads */}
        <ToolbarRow label="Gramene & data">
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
            style={{ width: 160, fontSize: 12 }}
            disabled={grameneStatus.state === 'loading'}
          />
          <button
            onClick={() => loadGramene(grameneGeneInput.trim())}
            disabled={grameneStatus.state === 'loading' || !grameneGeneInput.trim()}
            title="Two-step Gramene fetch: /genes → /genetrees, all per-leaf MSA + domain hits in one tree call."
          >
            {grameneStatus.state === 'loading' ? 'Loading…' : 'Load Gramene'}
          </button>
          <span
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
            title="Upload a CSV/TSV with a gene_id column — each upload creates a new table zone keyed by gene id, so it links directly to whichever tree is loaded (e.g. the Gramene tree)."
          >
            <label
              style={{
                fontSize: 12,
                padding: '2px 8px',
                border: '1px solid var(--tbrowse-border)',
                borderRadius: 3,
                cursor: 'pointer',
                background: 'var(--tbrowse-bg-input)',
              }}
            >
              Upload data…
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                multiple
                onChange={(e) => {
                  handleUploadedFiles(e.target.files);
                  e.target.value = '';
                }}
                style={{ display: 'none' }}
              />
            </label>
            {uploadedZones.length > 0 && (
              <span style={{ fontSize: 11, color: 'var(--tbrowse-text-muted)' }}>
                {uploadedZones.length} uploaded
              </span>
            )}
          </span>
          {grameneStatus.state === 'error' && (
            <span style={{ color: '#c0392b', fontSize: 12 }}>
              gramene error: {grameneStatus.error}
            </span>
          )}
          {uploadStatus.state === 'error' && uploadStatus.message && (
            <span style={{ color: '#c0392b', fontSize: 12 }}>
              upload: {uploadStatus.message}
            </span>
          )}
        </ToolbarRow>

        {/* 4 — global controls + status readouts */}
        <ToolbarRow label="Controls">
          <button onClick={reset}>reset</button>
          <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: 12 }}>
            theme:&nbsp;
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              style={{ fontSize: 12 }}
            >
              {theme === 'light' ? '☀ light' : '☾ dark'}
            </button>
          </span>
          <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: 12 }}>
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
          <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: 12 }}>
            selected: {viewState.selectedNodeId ?? '—'}
          </span>
          {stats && (
            <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: 12 }}>
              {stats.source}: {stats.leaves} leaves · {stats.nodes} nodes ·{' '}
              {stats.taxa} taxa · MSA {stats.msaLength} cols
            </span>
          )}
        </ToolbarRow>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <TBrowse
          {...dataProps}
          nodeOfInterest={dataSource === 'ensembl' ? ENSEMBL_GENE_OF_INTEREST : undefined}
          zones={zones}
          viewState={viewState}
          onViewStateChange={setViewState}
          theme={theme}
        />
      </div>
    </div>
  );
}

/** One row of the playground toolbar. Labels are aligned in a small
 *  fixed-width column so the section headings line up vertically across
 *  the four rows. */
function ToolbarRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '8px 12px',
        borderBottom: '1px solid var(--tbrowse-border-soft)',
      }}
    >
      <span
        style={{
          width: 110,
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--tbrowse-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          flex: '0 0 110px',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);
