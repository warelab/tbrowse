import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';
import {
  TBrowse,
  ensureThemeStylesInjected,
  createGenomeZone,
  createGenotypeMatrixZone,
  createTableZone,
  labelsZone,
  msaZone,
  neighborhoodZone,
  treeZone,
  useInitialViewState,
  useLoader,
  type PrunedNodeStyle,
  type RootReadyMode,
  type Tree,
  type UseLoaderResult,
  type ViewState,
  type ZoneDefinition,
} from 'tbrowse';
// Everything that fetches or parses lives in tbrowse-core (also usable from
// Node): the data sources and the loader contract, the view-state builders
// and the URL-hash codec. The viewer only adds the React glue (`useLoader`,
// `useInitialViewState`).
import {
  ENSEMBL_DEFAULT_MIRROR,
  ENSEMBL_MIRRORS,
  applyPivot,
  brapiAlleleMatrixSource,
  buildInitialViewState,
  computePivotState,
  ensemblGeneTreeSource,
  fileTreeSource,
  grameneGeneTreeSource,
  isViewStateLike,
  normalizeViewState,
  parseTableFile,
  readHashState,
  staticSource,
  writeHashState,
  type BrapiCtx,
  type BrapiMeta,
  type GenotypeMatrix,
  type DataSlot,
  type EnsemblCtx,
  type EnsemblMeta,
  type EnsemblMirror,
  type FileTreeCtx,
  type FileTreeMeta,
  type GrameneCtx,
  type GrameneMeta,
  type LoaderSnapshot,
  type SlotState,
  type TreeDataSource,
  type TreeFileFormat,
} from 'tbrowse-core';
import {
  sampleExpressionColumns,
  sampleExpressionTable,
  sampleRoot,
  sampleScoreColumns,
  sampleScoreTable,
  type SampleMeta,
  type SampleSize,
} from './sampleTree';
import { Layout } from './Layout';
import { AboutPage } from './AboutPage';
import { DevelopersPage } from './DevelopersPage';

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

const ENSEMBL_DEFAULT_GENE = 'ENSG00000139618'; // BRCA2 (human)
const GRAMENE_DEFAULT_GENE = 'SORBI_3006G095600';
// A standard BrAPI v2 `/allelematrix` on the public BrAPI test server
// (CORS-enabled; variantset1 is 20 variants × 13 callsets, no server-side
// tree, so the source clusters the samples with UPGMA). gramene-g2p's
// augmented endpoint works here too — the dev server proxies `/brapi` to
// BRAPI_PROXY_TARGET (default http://localhost:8080):
//   /brapi/v2/allelematrix-search?variantSetDbId=…&referenceName=22&start=…&end=…&minAF=0.05&maxAF=0.95&tree=upgma
const BRAPI_DEFAULT_URL = 'https://test-server.brapi.org/brapi/v2/allelematrix?variantSetDbId=variantset1';

const mirrorLabel = (m: EnsemblMirror) =>
  `${m.host.split('.')[0] === 'rest' ? 'current' : m.host.split('.')[0]} · r${m.release}`;

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
  'brapi-genotype': 50,
};

/**
 * Host zone id → the loader slots that feed it. Slot ids are the sources'
 * (`proteinDomains` / `overlap` from Ensembl, `neighborhood` /
 * `geneStructures` from Gramene, `germplasm` / `variants` from BrAPI); zone
 * ids are ours. The loader derives `zoneStatus` from this map, so zone
 * headers show a spinner / error glyph while their slot is in flight.
 */
const ZONE_SLOTS = {
  msa: ['proteinDomains'],
  'genome-canonical': ['overlap', 'geneStructures'],
  neighborhood: ['neighborhood'],
  labels: ['germplasm'],
  'brapi-genotype': ['variants'],
} as const satisfies Record<string, readonly string[]>;

// ─── Data sources ────────────────────────────────────────────────────────────

type SourceKind = 'sample' | 'ensembl' | 'gramene' | 'uploaded' | 'brapi';

interface SampleCtx {
  size: SampleSize;
}

/** The composite loader context: which source, plus that source's own ctx. */
type PlaygroundCtx =
  | { kind: 'sample'; ctx: SampleCtx }
  | { kind: 'ensembl'; ctx: EnsemblCtx }
  | { kind: 'gramene'; ctx: GrameneCtx }
  | { kind: 'uploaded'; ctx: FileTreeCtx }
  | { kind: 'brapi'; ctx: BrapiCtx };

type PlaygroundMeta = SampleMeta | EnsemblMeta | GrameneMeta | FileTreeMeta | BrapiMeta;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySource = TreeDataSource<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySlot = DataSlot<any, any, any>;

/** The bundled tree as a data source; "toggle tree size" is a ctx change. */
const sampleSource = staticSource((ctx: SampleCtx) => sampleRoot(ctx.size));

const SOURCES: Record<SourceKind, AnySource> = {
  sample: sampleSource,
  ensembl: ensemblGeneTreeSource,
  gramene: grameneGeneTreeSource,
  uploaded: fileTreeSource,
  brapi: brapiAlleleMatrixSource,
};

/**
 * Lifts one source's slot into the composite source: it only runs when
 * the composite ctx names its source, and it sees that source's own ctx.
 * Everything else (`toHostData`, `patchMeta`, `failWhen`, …) is reused.
 */
function liftSlot(kind: SourceKind, slot: AnySlot): DataSlot<unknown, PlaygroundCtx, PlaygroundMeta> {
  return {
    ...slot,
    enabled: (c, root) => c.kind === kind && slot.enabled?.(c.ctx, root) !== false,
    run: (sc) => slot.run({ ...sc, ctx: sc.ctx.ctx }),
  };
}

/**
 * The ONE source the playground runs: `loadRoot` dispatches on
 * `ctx.kind`, and the slots are every source's slots lifted with an
 * `enabled` guard (the ids never collide: `proteinDomains` / `overlap`,
 * `neighborhood` / `geneStructures`, `germplasm` / `variants`). A single
 * loader — rather than one per kind — keeps `snapshot.generation`
 * monotonic across source switches, which the playground's own
 * `activeRequestedAt` watermark and `swapsAppliedFor` guard rely on, and
 * keeps one `snapshot.slots` map for the toolbar readouts.
 * (`useInitialViewState` does not depend on it: it seeds once per
 * `snapshot.tree` object.)
 */
const playgroundSource: TreeDataSource<PlaygroundCtx, PlaygroundMeta> = {
  id: 'playground',
  label: 'Playground',
  loadRoot: ({ ctx, fetch, signal }) => SOURCES[ctx.kind].loadRoot({ ctx: ctx.ctx, fetch, signal }),
  slots: (Object.keys(SOURCES) as SourceKind[]).flatMap((kind) =>
    SOURCES[kind].slots.map((slot: AnySlot) => liftSlot(kind, slot)),
  ),
};

/**
 * What the loader is running: the loader ctx, the restart key for
 * `useLoader`, and what to do with the view state once this root is ready.
 * It flips on every click; what is on screen is a `LoadedRoot`, which
 * only follows once the load succeeds.
 */
type ActiveSource = PlaygroundCtx & {
  /** Restart identity: bumps on every explicit load, so re-clicking "Load" refetches. */
  key: string;
  /**
   * View-state policy for `useInitialViewState.onRootReady` (`'reset'` is
   * implied whenever there is no previous state): `'soft'` clears the
   * node-level fields but keeps the zone layout — a source / gene switch;
   * `'keep'` leaves the view untouched — a mirror switch (same gene, new
   * host) or the first root after a URL-hash bootstrap, whose stored view
   * must win over the pivot.
   */
  onReady: Exclude<RootReadyMode, 'reset'>;
};
type OnReady = ActiveSource['onReady'];

/** A root that loaded: the source it came from, its snapshot and the host props built from it. */
interface LoadedRoot {
  source: ActiveSource;
  snapshot: LoaderSnapshot<PlaygroundMeta>;
  props: NonNullable<UseLoaderResult<PlaygroundCtx, PlaygroundMeta>['hostProps']>;
}

let loadSeq = 0;
const keyFor = (kind: SourceKind, descriptor: string): string =>
  `${kind}:${descriptor}#${++loadSeq}`;

const sampleActive = (size: SampleSize, onReady: OnReady): ActiveSource => ({
  kind: 'sample',
  ctx: { size },
  key: keyFor('sample', size),
  onReady,
});
const ensemblActive = (geneId: string, host: string, onReady: OnReady): ActiveSource => ({
  kind: 'ensembl',
  ctx: { geneId, host },
  key: keyFor('ensembl', `${host}/${geneId}`),
  onReady,
});
const grameneActive = (geneId: string, onReady: OnReady): ActiveSource => ({
  kind: 'gramene',
  ctx: { geneId },
  key: keyFor('gramene', geneId),
  onReady,
});
const uploadedActive = (file: File, onReady: OnReady): ActiveSource => ({
  kind: 'uploaded',
  ctx: { file },
  key: keyFor('uploaded', `${file.name}:${file.size}:${file.lastModified}`),
  onReady,
});
/**
 * " · page of N variants × M samples" when a standard `/allelematrix`
 * response is one page of a larger matrix (its `pagination` block reports
 * per-dimension totals); empty otherwise.
 */
function brapiWindowNote(pagination: BrapiMeta['pagination'], matrix: GenotypeMatrix): string {
  if (!pagination) return '';
  const total = (dim: string): number | undefined => pagination.find((p) => p.dimension === dim)?.totalCount;
  const variants = total('VARIANTS');
  const samples = total('CALLSETS');
  if (variants === undefined || samples === undefined) return '';
  const shownVariants = matrix.variants.length;
  const shownSamples = Object.keys(matrix.callsByGeneId).length;
  if (variants <= shownVariants && samples <= shownSamples) return '';
  return ` · page of ${variants} variants × ${samples} samples`;
}

const brapiActive = (matrixUrl: string, onReady: OnReady): ActiveSource => ({
  kind: 'brapi',
  ctx: { matrixUrl },
  key: keyFor('brapi', matrixUrl),
  onReady,
});

/** Human-readable name of what is loading, for the status panel. */
function sourceLabel(a: ActiveSource): string {
  switch (a.kind) {
    case 'sample':
      return `the ${a.ctx.size} sample tree`;
    case 'ensembl':
      return `Ensembl gene tree for ${a.ctx.geneId}`;
    case 'gramene':
      return `Gramene gene tree for ${a.ctx.geneId ?? a.ctx.treeId ?? '?'}`;
    case 'uploaded':
      return typeof a.ctx.file === 'string' ? 'uploaded tree' : a.ctx.file.name ?? 'uploaded tree';
    case 'brapi':
      return 'BrAPI allele matrix';
  }
}

// ─── URL hash ────────────────────────────────────────────────────────────────

/**
 * URL-hash round-tripping for the playground's full state — the data
 * source, the serialisable part of its ctx (gene ids, REST host, matrix
 * URL; never a `File`), and the TBrowse `viewState` prop. Written with
 * `history.replaceState` so the back button stays uncluttered. A reload
 * restarts the same source, then the stored viewState is kept over the
 * fresh pivot — collapsed/pruned subtrees, NoI, MSA viewport, label
 * fields, search, zone widths/order and per-zone state all survive.
 */
interface PlaygroundUrlCtx {
  geneId?: string;
  host?: string;
  matrixUrl?: string;
  size?: SampleSize;
}

interface PlaygroundUrlState {
  source?: SourceKind;
  ctx?: PlaygroundUrlCtx;
  viewState?: Partial<ViewState>;
  /** Written by earlier playground builds; still honoured so old links keep working. */
  ensemblGeneId?: string;
  ensemblMirror?: string;
  grameneGeneId?: string;
}

const isPlaygroundUrlState = (v: unknown): v is PlaygroundUrlState =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function urlCtxOf(a: ActiveSource): PlaygroundUrlCtx {
  switch (a.kind) {
    case 'sample':
      return { size: a.ctx.size };
    case 'ensembl':
      return { geneId: a.ctx.geneId, ...(a.ctx.host !== undefined ? { host: a.ctx.host } : {}) };
    case 'gramene':
      return a.ctx.geneId !== undefined ? { geneId: a.ctx.geneId } : {};
    case 'uploaded':
      return {};
    case 'brapi':
      return { matrixUrl: a.ctx.matrixUrl };
  }
}

interface Bootstrap {
  active: ActiveSource;
  /** The stored view, normalised; `null` when the hash carried none. */
  viewState: ViewState | null;
  ensemblGene: string;
  ensemblHost: string;
  grameneGene: string;
  brapiUrl: string;
}

/**
 * Mount-time decode of the hash: which source to start, the input values
 * to seed, and the view state to hand `useInitialViewState` as `initial`.
 * A bad or absent hash lands on the sample tree with a fresh view.
 */
function bootstrapFromUrl(): Bootstrap {
  const url = readHashState<PlaygroundUrlState>(isPlaygroundUrlState);
  const source = url?.source;
  const ctx = url?.ctx ?? {};
  const viewState =
    url?.viewState !== undefined && isViewStateLike(url.viewState)
      ? normalizeViewState(url.viewState)
      : null;
  // Only a stored view can be kept; otherwise the root's own pivot applies.
  const onReady: OnReady = viewState ? 'keep' : 'soft';
  const ensemblGene =
    (source === 'ensembl' ? ctx.geneId : undefined) ?? url?.ensemblGeneId ?? ENSEMBL_DEFAULT_GENE;
  const ensemblHost =
    (source === 'ensembl' ? ctx.host : undefined) ?? url?.ensemblMirror ?? ENSEMBL_DEFAULT_MIRROR;
  const grameneGene =
    (source === 'gramene' ? ctx.geneId : undefined) ?? url?.grameneGeneId ?? GRAMENE_DEFAULT_GENE;
  const brapiUrl = (source === 'brapi' ? ctx.matrixUrl : undefined) ?? BRAPI_DEFAULT_URL;
  let active: ActiveSource;
  switch (source) {
    case 'ensembl':
      active = ensemblActive(ensemblGene, ensemblHost, onReady);
      break;
    case 'gramene':
      active = grameneActive(grameneGene, onReady);
      break;
    case 'brapi':
      active = brapiActive(brapiUrl, onReady);
      break;
    default:
      // An uploaded tree cannot be restored (the File never reaches the
      // URL): fall back to the sample tree, keeping the stored layout but
      // not node ids that belonged to the upload.
      active = sampleActive(
        ctx.size === 'large' ? 'large' : 'small',
        source === 'uploaded' ? 'soft' : onReady,
      );
  }
  return { active, viewState, ensemblGene, ensemblHost, grameneGene, brapiUrl };
}

// ─── View state ──────────────────────────────────────────────────────────────

/**
 * Every zone visible at its playground width. The kitchen-sink demo shows
 * everything up front rather than honouring the zones' own
 * `defaultVisible` / exclusive-group defaults, so this goes in as
 * `overrides.zones` (which `buildInitialViewState` spreads last).
 */
const allZonesVisible = (zs: readonly ZoneDefinition<any>[]) =>
  zs.map((z) => ({ id: z.id, width: INITIAL_ZONE_FR[z.id] ?? 25, visible: true }));

function freshViewState(zs: readonly ZoneDefinition<any>[]): ViewState {
  return buildInitialViewState(zs, { overrides: { zones: allZonesVisible(zs) } });
}

function countLeaves(tree: Tree): number {
  let n = 0;
  for (const node of Object.values(tree.nodes)) if (node.isLeaf) n++;
  return n;
}

// ─── The playground ──────────────────────────────────────────────────────────

export function Playground() {
  // Decoded once per mount (StrictMode's double call is harmless: the
  // function is pure apart from the restart-key counter).
  const [boot] = useState(bootstrapFromUrl);
  /** What the loader runs; switches on every click (through `activate`). What is on screen is `shown`, below. */
  const [active, setActive] = useState<ActiveSource>(boot.active);
  const [sampleSize, setSampleSize] = useState<SampleSize>(
    boot.active.kind === 'sample' ? boot.active.ctx.size : 'small',
  );
  const [ensemblGeneInput, setEnsemblGeneInput] = useState(boot.ensemblGene);
  /** Picker selection; the host the tree was actually loaded from is `active.ctx.host`. */
  const [ensemblMirror, setEnsemblMirror] = useState(boot.ensemblHost);
  const [grameneGeneInput, setGrameneGeneInput] = useState(boot.grameneGene);
  const [brapiUrl, setBrapiUrl] = useState(boot.brapiUrl);
  /** The last tree file that PARSED (format + leaf count captured when its
   *  root arrived); "View uploaded" re-runs it through the file source. A
   *  file the source rejected is only ever reported in the row's error. */
  const [uploaded, setUploaded] = useState<{
    file: File;
    format: TreeFileFormat;
    leaves: number;
  } | null>(null);
  /** Uploads are scoped to the data source they were added under, so a
   *  CSV uploaded while looking at the sample tree doesn't follow the
   *  user into Gramene mode (where its gene ids would resolve to
   *  nothing) and vice versa. The chassis hides any zone whose
   *  `isAvailable(data)` returns false anyway, but keeping uploads
   *  partitioned avoids stale entries from cluttering the Zones list. */
  const [uploadedZonesBySource, setUploadedZonesBySource] = useState<
    Record<SourceKind, ZoneDefinition[]>
  >({ sample: [], ensembl: [], gramene: [], uploaded: [], brapi: [] });
  const [uploadStatus, setUploadStatus] = useState<{
    state: 'idle' | 'error';
    message?: string;
  }>({ state: 'idle' });

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  // Embedding / cosmetic props (TBrowseProps.showHeader / rowHeight / fontSize).
  const [showHeader, setShowHeader] = useState(true);
  const [rowHeight, setRowHeight] = useState(24);
  const [fontSize, setFontSize] = useState(12);

  // ── The one loader. `active` is the ctx; `active.key` restarts it. ──
  const { snapshot, loader, hostProps } = useLoader(playgroundSource, active, {
    key: active.key,
    zoneSlots: ZONE_SLOTS,
  });

  // `useLoader` restarts in an effect, so the render that changes `active`
  // still sees the previous run's snapshot. Every switch therefore records
  // the loader generation it was requested at: only a newer snapshot is
  // `active`'s own; an older one belongs to whatever loaded before. (Read
  // off the loader rather than the rendered `snapshot` so the watermark is
  // the live value even if a store update has not rendered yet.)
  const activeRequestedAt = useRef(-1);
  const activate = (next: ActiveSource) => {
    activeRequestedAt.current = loader.getSnapshot().generation;
    setActive(next);
  };
  const isActiveSnapshot = snapshot.generation > activeRequestedAt.current;
  /** `active`'s own root status — `'loading'` until the loader has picked it up. */
  const activeStatus = isActiveSnapshot && snapshot.status !== 'idle' ? snapshot.status : 'loading';

  // ── What is on screen ──
  // `active` flips on click, but the playground's MODE — the zone list,
  // the toolbar enablement, the stats line and the URL hash — follows the
  // root that actually loaded, as the old per-source state did: a 4xx from
  // Ensembl or an unparseable file leaves the previous tree and mode in
  // place and is only reported in that source's toolbar row. `loaded` is
  // `active`'s own ready root (null while in flight or failed); `shownRoot`
  // keeps the last one across the gap, so the chassis only swaps once the
  // next root is ready.
  const loaded = useMemo<LoadedRoot | null>(
    () => (hostProps && isActiveSnapshot ? { source: active, snapshot, props: hostProps } : null),
    [hostProps, isActiveSnapshot, active, snapshot],
  );
  const lastLoaded = useRef<LoadedRoot | null>(null);
  useEffect(() => {
    if (loaded) lastLoaded.current = loaded;
  }, [loaded]);
  const shownRoot = loaded ?? lastLoaded.current;
  /** The source whose tree is on screen; the bootstrapped one until a first root arrives. */
  const shown: ActiveSource = shownRoot?.source ?? boot.active;
  const shownMeta = shownRoot?.snapshot.root?.meta ?? null;
  const brapiMeta = shown.kind === 'brapi' && shownMeta !== null && 'matrix' in shownMeta ? shownMeta : null;
  const fileMeta =
    shown.kind === 'uploaded' && shownMeta !== null && 'warnings' in shownMeta ? shownMeta : null;
  // From the last READY BrAPI root rather than the live snapshot (whose
  // root is null while a BrAPI → BrAPI reload is in flight), so the
  // genotype zone stays registered across the reload and keeps the user's
  // width / visibility, as `'soft'` promises. Still replaced when the
  // `variants` slot patches REF/ALT into the matrix: that swaps
  // `snapshot.root` while the status stays `'ready'`, so `loaded` — and
  // with it this matrix — is rebuilt.
  const matrix = brapiMeta?.matrix ?? null;

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
  // BrAPI genotype-matrix zone — rebuilt whenever the matrix changes (a
  // new root, or the `variants` slot enriching it) so the factory
  // captures the current data; same id, so `ensureZones` keeps its view
  // entry. Null until a BrAPI root is ready.
  const genotypeZone = useMemo(
    () =>
      matrix
        ? createGenotypeMatrixZone({
            id: 'brapi-genotype',
            displayName: 'Genotypes',
            matrix,
            defaultWidth: 50,
            minWidth: 240,
          })
        : null,
    [matrix],
  );
  const zones = useMemo(
    () => [
      treeZone,
      labelsZone,
      msaZone,
      neighborhoodZone,
      genomeZone,
      // The sample-scoped factory tables live alongside the sample's
      // own uploads under the 'sample' bucket; together they're only
      // wired in while the sample tree is the one on screen.
      ...(shown.kind === 'sample' ? [expressionZone, scoresZone] : []),
      ...(genotypeZone ? [genotypeZone] : []),
      ...(uploadedZonesBySource[shown.kind] ?? []),
    ],
    [genomeZone, expressionZone, scoresZone, genotypeZone, uploadedZonesBySource, shown.kind],
  );

  const overrides = useMemo(() => ({ zones: allZonesVisible(zones) }), [zones]);
  const [viewState, setViewState] = useInitialViewState(zones, snapshot, {
    overrides,
    initial: boot.viewState,
    onRootReady: (_snap, prev) => (prev === null ? 'reset' : active.onReady),
  });

  // BrAPI: once the root is in, reproduce the server's leaf order (the
  // swaps `fromBRAPITree` computed) and default the labels to
  // germplasm-flavoured fields, since the leaves are samples, not genes.
  // Runs after useInitialViewState's own seeding (declared above) in the
  // same commit; once per loader generation (a `variants` patch replaces
  // `shownRoot` but not its generation); skipped for a URL bootstrap,
  // whose stored view already carries both.
  const swapsAppliedFor = useRef(-1);
  useEffect(() => {
    if (!brapiMeta || !shownRoot) return;
    if (swapsAppliedFor.current === shownRoot.snapshot.generation) return;
    swapsAppliedFor.current = shownRoot.snapshot.generation;
    if (shownRoot.source.onReady === 'keep') return;
    const swappedNodeIds = brapiMeta.swappedNodeIds;
    setViewState((vs) =>
      vs
        ? {
            ...vs,
            swappedNodeIds,
            zoneStates: {
              ...vs.zoneStates,
              labels: {
                ...(vs.zoneStates.labels as Record<string, unknown> | undefined),
                visibleFields: ['germplasm.id', 'germplasm.species'],
              },
            },
          }
        : vs,
    );
  }, [brapiMeta, shownRoot, setViewState]);

  // Remember what the uploaded file parsed to, for the toolbar readout and
  // "View uploaded" — only once its root is on screen, so neither is
  // offered for a file the source rejected.
  useEffect(() => {
    if (!shownRoot) return;
    const { source, snapshot: loadedSnapshot, props } = shownRoot;
    if (source.kind !== 'uploaded') return;
    const meta = loadedSnapshot.root?.meta;
    const file = source.ctx.file;
    if (!(file instanceof File) || !meta || !('warnings' in meta)) return;
    setUploaded({ file, format: meta.format, leaves: countLeaves(props.tree) });
  }, [shownRoot]);

  // Mirror the SHOWN source + ctx + viewState into the URL hash so the
  // playground state is shareable; a failed load never reaches the URL.
  useEffect(() => {
    if (!viewState) return;
    writeHashState({ source: shown.kind, ctx: urlCtxOf(shown), viewState }, 'replace');
  }, [shown, viewState]);

  // ── Source switches: each one is just a new `active` (via `activate`) ──

  const loadEnsembl = (geneIdRaw: string) => {
    const geneId = geneIdRaw.trim();
    if (geneId === '') return;
    activate(ensemblActive(geneId, ensemblMirror, 'soft'));
  };

  /**
   * Switching release invalidates everything derived from the tree —
   * alignment width, protein ids and gene models all differ between
   * Ensembl releases. Restarting the loader drops the slots, then
   * re-fetches from the new host. Which gene, and with which view policy,
   * depends on what is on screen:
   * - the Ensembl tree being shown (`shown`; `active` may hold an
   *   unrelated failed load): the same gene with `'keep'`, so the user
   *   keeps their collapsed/pruned subtrees;
   * - an Ensembl load that FAILED, or asked for a gene other than the one
   *   on screen: that gene with `'soft'` — its tree was never shown, so
   *   there is no view to keep and the pivot must apply;
   * - no Ensembl tree shown or pending: nothing to reload; the picker just
   *   sets the host for the next load.
   */
  const handleMirrorChange = (host: string) => {
    if (host === ensemblMirror) return;
    setEnsemblMirror(host);
    const onScreen = shown.kind === 'ensembl' ? shown.ctx.geneId : null;
    const requested = active.kind === 'ensembl' ? active.ctx.geneId : null;
    if (requested !== null && requested !== onScreen) {
      activate(ensemblActive(requested, host, 'soft'));
    } else if (onScreen !== null) {
      activate(ensemblActive(onScreen, host, 'keep'));
    }
  };

  const loadGramene = (geneIdRaw: string) => {
    const geneId = geneIdRaw.trim();
    if (geneId === '') return;
    activate(grameneActive(geneId, 'soft'));
  };

  const loadBrapi = (urlRaw: string) => {
    const url = urlRaw.trim();
    if (url === '') return;
    activate(brapiActive(url, 'soft'));
  };

  const switchToSample = () => activate(sampleActive(sampleSize, 'soft'));

  const toggleSampleSize = () => {
    const next: SampleSize = sampleSize === 'small' ? 'large' : 'small';
    setSampleSize(next);
    activate(sampleActive(next, 'soft'));
  };

  /** Hand a Newick / Nexus / PhyloXML file off an <input type=file> to the
   *  file source. Parse errors surface as the source's root error (the
   *  toolbar's "tree:" span) and leave the previous tree in place; soft
   *  warnings (duplicate labels, trailing junk) arrive in `meta.warnings`
   *  and become a status line. The file is only remembered (`uploaded`)
   *  once its root loaded. */
  const handleUploadedTree = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    activate(uploadedActive(file, 'soft'));
  };

  const viewUploaded = () => {
    if (uploaded) activate(uploadedActive(uploaded.file, 'soft'));
  };

  /** CSV / TSV → `parseTableFile` → one table zone per file, filed under
   *  the source it was uploaded for. `useInitialViewState` appends the
   *  zone's view entry when it joins the zone list. */
  const handleUploadedFiles = async (files: FileList | null, source: SourceKind) => {
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
        const id = `upload-${source}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const zone = createTableZone({
          id,
          defaultName: stem,
          table: parsed.table,
          columns: parsed.columns,
          defaultWidth: 14,
          minWidth: 140,
        });
        setUploadedZonesBySource((prev) => ({
          ...prev,
          [source]: [...(prev[source] ?? []), zone],
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

  // ── Lazy slots (Ensembl fan-outs) ──

  const loadSlot = (id: string) => {
    loader.load(id).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn(`load(${id}) failed:`, err);
    });
  };
  const slotOf = (id: string): SlotState | undefined => snapshot.slots[id];
  const domainsSlot = active.kind === 'ensembl' ? slotOf('proteinDomains') : undefined;
  const overlapSlot = active.kind === 'ensembl' ? slotOf('overlap') : undefined;
  const failedCount = (s: SlotState | undefined): number =>
    s?.itemErrors ? Object.keys(s.itemErrors).length : 0;
  const progressOf = (s: SlotState): string =>
    `${s.progress?.done ?? 0}/${s.progress?.total ?? 0}`;
  /** `"<slot>: <error>"` for every errored slot among `ids`. */
  const slotErrors = (ids: readonly string[]): string[] =>
    ids.flatMap((id) => {
      const s = slotOf(id);
      return s?.status === 'error' ? [`${id}: ${s.error}`] : [];
    });

  // The per-row loading / error readouts follow `active` (the load the
  // user asked for); the mode follows `shown`.
  const loadingKind = activeStatus === 'loading' ? active.kind : null;
  const errorFor = (kind: SourceKind): string | null =>
    active.kind === kind && activeStatus === 'error' ? snapshot.error : null;

  // ── View-state controls ──

  const patchViewState = (patch: Partial<ViewState>) =>
    setViewState((vs) => (vs ? { ...vs, ...patch } : vs));
  const setCollapsed = (ids: string[]) => patchViewState({ collapsedNodeIds: ids });
  const setPruned = (ids: string[]) => patchViewState({ prunedNodeIds: ids });
  const reset = () => setViewState(freshViewState(zones));

  const prunedStyle =
    ((viewState?.zoneStates.tree as { prunedNodeStyle?: PrunedNodeStyle } | undefined)
      ?.prunedNodeStyle) ?? 'triangle';
  const setPrunedStyle = (next: PrunedNodeStyle) =>
    setViewState((vs) =>
      vs
        ? {
            ...vs,
            zoneStates: {
              ...vs.zoneStates,
              tree: { ...(vs.zoneStates.tree ?? {}), prunedNodeStyle: next },
            },
          }
        : vs,
    );

  const pivotTo = (identifier: string) => {
    const tree = shownRoot?.props.tree;
    if (!tree) return;
    const pivot = computePivotState(tree, identifier);
    if (!pivot) return;
    setViewState((vs) =>
      applyPivot(
        {
          ...freshViewState(zones),
          ...(vs ? { zones: vs.zones, zoneStates: vs.zoneStates } : {}),
        },
        pivot,
      ),
    );
  };

  const stats = shownRoot
    ? {
        leaves: countLeaves(shownRoot.props.tree),
        nodes: Object.keys(shownRoot.props.tree.nodes).length,
        taxa: Object.keys(shownRoot.snapshot.root?.taxonomy ?? {}).length,
        msaLength: shownRoot.snapshot.data.msa?.length ?? 0,
      }
    : null;

  return (
    <div
      // Wrap in tbrowse-root + tbrowse-theme-* so the toolbar and panel
      // pick up the same CSS vars TBrowse uses, and the page background
      // flips with the theme toggle. `height: 100%` fills the routed
      // <main>; the navbar lives in the shared Layout above this.
      className={`tbrowse-root tbrowse-theme-${theme}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
      }}
    >
      <PlaygroundIntro />
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
          <button onClick={switchToSample} disabled={shown.kind === 'sample'}>
            Sample
          </button>
          <button onClick={() => setCollapsed(['n1'])} disabled={shown.kind !== 'sample'}>
            collapse n1
          </button>
          <button onClick={() => setCollapsed(['n3'])} disabled={shown.kind !== 'sample'}>
            collapse n3
          </button>
          <button onClick={() => setPruned(['n1'])} disabled={shown.kind !== 'sample'}>
            prune n1
          </button>
          <button onClick={() => setPruned(['n4'])} disabled={shown.kind !== 'sample'}>
            prune n4
          </button>
          <button
            onClick={() => pivotTo('ENSG00000000001')}
            disabled={shown.kind !== 'sample'}
          >
            pivot to Human
          </button>
          <button
            onClick={() => pivotTo('ENSDARG00000001')}
            disabled={shown.kind !== 'sample'}
          >
            pivot to Zebrafish
          </button>
          <button onClick={toggleSampleSize} disabled={shown.kind !== 'sample'}>
            toggle tree size
          </button>
        </ToolbarRow>

        {/* 2 — Ensembl tree + lazy fan-out slots + ensembl-scoped uploads */}
        <ToolbarRow label="Ensembl">
          <select
            value={ensemblMirror}
            onChange={(e) => handleMirrorChange(e.target.value)}
            disabled={loadingKind === 'ensembl'}
            style={{ fontSize: 12 }}
            title={
              'REST host to fetch from. Archive hosts pin one Ensembl ' +
              'release and run separately from rest.ensembl.org, which ' +
              'intermittently returns 5xx under load. Switching reloads ' +
              'the current tree and clears release-specific data.'
            }
          >
            {ENSEMBL_MIRRORS.map((m) => (
              <option key={m.host} value={m.host}>
                {mirrorLabel(m)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={ensemblGeneInput}
            onChange={(e) => setEnsemblGeneInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ensemblGeneInput.trim()) loadEnsembl(ensemblGeneInput);
            }}
            placeholder="Ensembl gene id"
            style={{ width: 180, fontSize: 12 }}
            disabled={loadingKind === 'ensembl'}
          />
          <button
            onClick={() => loadEnsembl(ensemblGeneInput)}
            disabled={loadingKind === 'ensembl' || !ensemblGeneInput.trim()}
          >
            {loadingKind === 'ensembl' ? 'Loading…' : 'Load Ensembl tree'}
          </button>
          <button
            onClick={() => loadSlot('proteinDomains')}
            disabled={
              !domainsSlot ||
              !loaded ||
              domainsSlot.status === 'loading' ||
              domainsSlot.status === 'ready'
            }
            title="Runs the source's lazy `proteinDomains` slot: /overlap/translation/{ENSP} for each leaf, through fromEnsemblProteinFeatures."
          >
            {!domainsSlot || domainsSlot.status === 'idle' || domainsSlot.status === 'error'
              ? 'Load Pfam domains'
              : domainsSlot.status === 'loading'
                ? `Loading domains ${progressOf(domainsSlot)}…`
                : failedCount(domainsSlot)
                  ? `Pfam domains (cached, ${failedCount(domainsSlot)} failed)`
                  : 'Pfam domains (cached)'}
          </button>
          <button
            onClick={() => loadSlot('overlap')}
            disabled={
              !overlapSlot ||
              !loaded ||
              overlapSlot.status === 'loading' ||
              overlapSlot.status === 'ready'
            }
            title="Runs the source's lazy `overlap` slot: /overlap/id/{geneId} for each leaf — drives the Genome zone (gene structure + regulatory features)."
          >
            {!overlapSlot || overlapSlot.status === 'idle' || overlapSlot.status === 'error'
              ? 'Load gene structures'
              : overlapSlot.status === 'loading'
                ? `Loading gene structures ${progressOf(overlapSlot)}…`
                : 'Gene structures (cached)'}
          </button>
          <UploadDataLabel
            source="ensembl"
            count={uploadedZonesBySource.ensembl.length}
            onFiles={handleUploadedFiles}
          />
          {domainsSlot?.status === 'error' && (
            <ErrorText>domains error: {domainsSlot.error}</ErrorText>
          )}
          {overlapSlot?.status === 'error' && (
            <ErrorText>overlap error: {overlapSlot.error}</ErrorText>
          )}
          {errorFor('ensembl') && <ErrorText>error: {errorFor('ensembl')}</ErrorText>}
        </ToolbarRow>

        {/* 3 — Gramene tree (+ eager neighborhood / gene-structure slots) + gramene-scoped uploads */}
        <ToolbarRow label="Gramene">
          <input
            type="text"
            value={grameneGeneInput}
            onChange={(e) => setGrameneGeneInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && grameneGeneInput.trim()) loadGramene(grameneGeneInput);
            }}
            placeholder="Gramene gene id"
            style={{ width: 180, fontSize: 12 }}
            disabled={loadingKind === 'gramene'}
          />
          <button
            onClick={() => loadGramene(grameneGeneInput)}
            disabled={loadingKind === 'gramene' || !grameneGeneInput.trim()}
            title="Two-step Gramene fetch: /genes → /genetrees, all per-leaf MSA + domain hits in one tree call; neighbourhoods and gene structures follow as eager slots."
          >
            {loadingKind === 'gramene' ? 'Loading…' : 'Load Gramene'}
          </button>
          <UploadDataLabel
            source="gramene"
            count={uploadedZonesBySource.gramene.length}
            onFiles={handleUploadedFiles}
          />
          {errorFor('gramene') && <ErrorText>gramene error: {errorFor('gramene')}</ErrorText>}
          {active.kind === 'gramene' &&
            slotErrors(['neighborhood', 'geneStructures']).map((msg) => (
              <ErrorText key={msg}>{msg}</ErrorText>
            ))}
          {uploadStatus.state === 'error' && uploadStatus.message && (
            <ErrorText>upload: {uploadStatus.message}</ErrorText>
          )}
        </ToolbarRow>

        {/* 4 — BrAPI allele matrix: tree + genotype zone, germplasm + variants slots */}
        <ToolbarRow label="BrAPI">
          <input
            type="text"
            value={brapiUrl}
            onChange={(e) => setBrapiUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && brapiUrl.trim()) loadBrapi(brapiUrl);
            }}
            placeholder="https://…/brapi/v2/allelematrix?variantSetDbId=…"
            style={{ width: 460, fontSize: 12 }}
            disabled={loadingKind === 'brapi'}
          />
          <button
            onClick={() => loadBrapi(brapiUrl)}
            disabled={loadingKind === 'brapi' || !brapiUrl.trim()}
            title="Fetch a BrAPI v2 allele matrix (a standard /allelematrix page, or gramene-g2p's /allelematrix-search with tree=upgma for the server's tree; otherwise the samples are clustered locally with UPGMA) and render the genotype-matrix zone; /germplasm and /variants follow as eager slots."
          >
            {loadingKind === 'brapi' ? 'Loading…' : 'Load BrAPI'}
          </button>
          <UploadDataLabel
            source="brapi"
            count={uploadedZonesBySource.brapi.length}
            onFiles={handleUploadedFiles}
          />
          {matrix && (
            <MutedText>
              {matrix.variants.length} variants · {Object.keys(matrix.callsByGeneId).length}{' '}
              samples
              {matrix.regionLabel ? ` · ${matrix.regionLabel}` : ''}
              {brapiMeta?.treeMethod ? ` · tree: ${brapiMeta.treeMethod}` : ''}
              {brapiWindowNote(brapiMeta?.pagination, matrix)}
            </MutedText>
          )}
          {errorFor('brapi') && <ErrorText>brapi error: {errorFor('brapi')}</ErrorText>}
          {active.kind === 'brapi' &&
            slotErrors(['germplasm', 'variants']).map((msg) => (
              <ErrorText key={msg}>{msg}</ErrorText>
            ))}
        </ToolbarRow>

        {/* 5 — host-uploaded tree + uploaded-source data uploads */}
        <ToolbarRow label="Upload tree">
          <span
            style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
            title="Upload a tree file (Newick, Nexus, or PhyloXML). Format is auto-detected."
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
              Upload tree…
              <input
                type="file"
                accept=".nwk,.newick,.tree,.tre,.nex,.nexus,.xml,.phyloxml,.txt,text/plain,application/xml,text/xml"
                onChange={(e) => {
                  handleUploadedTree(e.target.files);
                  e.target.value = '';
                }}
                style={{ display: 'none' }}
              />
            </label>
            {uploaded && (
              <MutedText small>
                {uploaded.file.name} ({describeFormat(uploaded.format)}, {uploaded.leaves} leaves)
              </MutedText>
            )}
          </span>
          {uploaded && (
            <button onClick={viewUploaded} disabled={shown.kind === 'uploaded'}>
              View uploaded
            </button>
          )}
          <UploadDataLabel
            source="uploaded"
            count={uploadedZonesBySource.uploaded.length}
            onFiles={handleUploadedFiles}
          />
          {errorFor('uploaded') && (
            <ErrorText>
              tree: {sourceLabel(active)}: {errorFor('uploaded')}
            </ErrorText>
          )}
          {fileMeta && fileMeta.warnings.length > 0 && (
            <ErrorText>tree: {fileMeta.warnings.join('; ')}</ErrorText>
          )}
        </ToolbarRow>

        {/* 6 — global controls + status readouts */}
        <ToolbarRow label="Controls">
          <button onClick={reset}>reset</button>
          <MutedText>
            theme:&nbsp;
            <button
              type="button"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
              style={{ fontSize: 12 }}
            >
              {theme === 'light' ? '☀ light' : '☾ dark'}
            </button>
          </MutedText>
          <label style={{ color: 'var(--tbrowse-text-muted)', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={showHeader}
              onChange={(e) => setShowHeader(e.target.checked)}
            />
            &nbsp;header
          </label>
          <MutedText>
            row&nbsp;
            <input
              type="range"
              min={12}
              max={48}
              step={1}
              value={rowHeight}
              onChange={(e) => setRowHeight(+e.target.value)}
              title={`row height: ${rowHeight}px`}
              style={{ verticalAlign: 'middle', width: 90 }}
            />
            &nbsp;{rowHeight}px
          </MutedText>
          <MutedText>
            font&nbsp;
            <input
              type="range"
              min={8}
              max={20}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(+e.target.value)}
              title={`font size: ${fontSize}px`}
              style={{ verticalAlign: 'middle', width: 90 }}
            />
            &nbsp;{fontSize}px
          </MutedText>
          <MutedText>
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
          </MutedText>
          <MutedText>selected: {viewState?.selectedNodeId ?? '—'}</MutedText>
          {stats && (
            <MutedText>
              {shown.kind}: {stats.leaves} leaves · {stats.nodes} nodes
              {stats.taxa > 0 ? ` · ${stats.taxa} taxa` : ''}
              {stats.msaLength > 0 ? ` · MSA ${stats.msaLength} cols` : ''}
            </MutedText>
          )}
        </ToolbarRow>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {shownRoot && viewState ? (
          <TBrowse
            {...shownRoot.props}
            zones={zones}
            viewState={viewState}
            onViewStateChange={setViewState}
            theme={theme}
            showHeader={showHeader}
            rowHeight={rowHeight}
            fontSize={fontSize}
          />
        ) : (
          <LoadStatus active={active} status={activeStatus} error={snapshot.error} />
        )}
      </div>
      <PlaygroundFooter />
    </div>
  );
}

/** Shown in place of the chassis until the first root has arrived. */
function LoadStatus({
  active,
  status,
  error,
}: {
  active: ActiveSource;
  status: LoaderSnapshot<PlaygroundMeta>['status'];
  error: string | null;
}) {
  const failed = status === 'error';
  const label = sourceLabel(active);
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        color: failed ? '#c0392b' : 'var(--tbrowse-text-muted)',
        fontSize: 13,
      }}
    >
      {failed ? `${label}: ${error}` : `Loading ${label}…`}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <span style={{ color: '#c0392b', fontSize: 12 }}>{children}</span>;
}

function MutedText({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return (
    <span style={{ color: 'var(--tbrowse-text-muted)', fontSize: small ? 11 : 12 }}>
      {children}
    </span>
  );
}

/** Intro banner shown at the top of the playground, below the navbar.
 *  Orients first-time visitors before they reach the dense toolbar. */
function PlaygroundIntro() {
  return (
    <div
      style={{
        flex: '0 0 auto',
        padding: '10px 16px',
        borderBottom: '1px solid var(--tbrowse-divider)',
        background: 'var(--tbrowse-bg)',
        color: 'var(--tbrowse-text)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <strong style={{ fontSize: 14 }}>Playground</strong> — a live sandbox for
      TBrowse. Start with the bundled <em>Sample</em> tree, or load a real gene
      tree from <strong>Ensembl</strong> or <strong>Gramene</strong> by id, a
      sample tree with genotypes from a <strong>BrAPI</strong> allele matrix,
      or upload your own Newick / PhyloXML / Nexus file. Then explore:
      collapse and prune subtrees, search, resize and reorder zones, and
      toggle the light/dark theme. Your view is encoded into the URL, so you
      can copy the link to share an exact state. New here?{' '}
      <Link to="/" style={{ color: 'var(--tbrowse-accent)' }}>
        Read about TBrowse
      </Link>{' '}
      or see the{' '}
      <Link to="/developers" style={{ color: 'var(--tbrowse-accent)' }}>
        developer guide
      </Link>
      .
    </div>
  );
}

/** Sticky bottom bar pinned to the playground's flex column. The
 *  parent `.tbrowse-root` is `display: flex; flex-direction: column`
 *  with a `flex: 1` child wrapping <TBrowse>, so a `flex: 0 0 auto`
 *  footer here naturally sticks below the chassis without overlap. */
function PlaygroundFooter() {
  return (
    <footer
      style={{
        flex: '0 0 auto',
        padding: '6px 12px',
        borderTop: '1px solid var(--tbrowse-divider)',
        background: 'var(--tbrowse-bg-strip)',
        color: 'var(--tbrowse-text-muted)',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
      }}
    >
      <a
        href="https://github.com/warelab/tbrowse"
        target="_blank"
        rel="noopener noreferrer"
        title="View source on GitHub"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          color: 'var(--tbrowse-text-muted)',
          textDecoration: 'none',
        }}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>warelab/tbrowse</span>
      </a>
    </footer>
  );
}

function describeFormat(f: TreeFileFormat): string {
  return f === 'phyloxml' ? 'PhyloXML' : f === 'nexus' ? 'Nexus' : 'Newick';
}

/** Upload-CSV-as-table-zone control. Shared between the Ensembl, Gramene,
 *  BrAPI and upload toolbar rows; passes its `source` to the host so the
 *  new table zone is filed under the right per-source bucket and only
 *  shows up when the user is actually viewing that source's tree. */
function UploadDataLabel({
  source,
  count,
  onFiles,
}: {
  source: SourceKind;
  count: number;
  onFiles: (files: FileList | null, source: SourceKind) => void;
}) {
  return (
    <span
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
      title={`Upload a CSV/TSV with a gene_id column — adds a table zone scoped to the ${source} tree.`}
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
            onFiles(e.target.files, source);
            e.target.value = '';
          }}
          style={{ display: 'none' }}
        />
      </label>
      {count > 0 && (
        <span style={{ fontSize: 11, color: 'var(--tbrowse-text-muted)' }}>
          {count} uploaded
        </span>
      )}
    </span>
  );
}

/** One row of the playground toolbar. Labels are aligned in a small
 *  fixed-width column so the section headings line up vertically across
 *  the rows. */
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

// Make the `--tbrowse-*` theme tokens available on every route, including
// the marketing pages where no <TBrowse> mounts to inject them itself.
ensureThemeStylesInjected();

// BrowserRouter so the playground keeps `location.hash` for its own
// shareable view-state encoding. `basename` tracks Vite's base path
// (`/` in dev, `/tbrowse/` for the GitHub Pages build).
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { index: true, element: <AboutPage /> },
        { path: 'playground', element: <Playground /> },
        { path: 'developers', element: <DevelopersPage /> },
        { path: '*', element: <AboutPage /> },
      ],
    },
  ],
  { basename },
);

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
