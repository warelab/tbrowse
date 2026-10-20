# tbrowse

Embeddable React component for visualizing phylogenetic trees with pluggable data zones.

`<TBrowse>` renders a tree alongside a row-aligned set of zones (Tree, Labels, MSA, custom plug-ins). Tree topology, taxonomy, MSA, gene metadata, and per-node annotations are independent host inputs — TBrowse does no fetching of its own. View state (selection, collapse, prune, swap, zone widths, MSA viewport, search) is a single serializable object that round-trips through URL state via the controlled `viewState` / `onViewStateChange` props.

## Status

`2.0.0` is a complete rewrite of the original component on a fresh React 18 / TypeScript / Zustand stack. The 1.x line on npm (`tbrowse@1.0.x`) is the previous nwb / React 16 / Redux-Toolkit implementation, preserved at commit `b017a74` for archival reference. The 2.0 API is **not backwards-compatible** with 1.x.

The rewrite is functionally complete: chassis, four built-in zones (Tree / Labels / MSA / Neighborhood), Ensembl REST and Gramene adapters, animated transitions, branch-length compression, gene-family coloring, protein-domain annotations, splice-junction marks, and a `nodeOfInterest` pivot. See [CHANGELOG.md](./CHANGELOG.md) for the migration summary.

## Quick start

```tsx
import { TBrowse, treeZone, labelsZone, msaZone, type Tree, type MSA, type Taxonomy } from 'tbrowse';

const tree: Tree = { rootId: 'n0', nodes: { /* ... */ } };
const taxonomy: Taxonomy = { /* taxId → { scientificName, commonName, ... } */ };
const msa: MSA = { alphabet: 'protein', length: 60, sequences: { /* geneId → string */ } };

<div style={{ width: 900, height: 600 }}>
  <TBrowse
    tree={tree}
    taxonomy={taxonomy}
    msa={msa}
    zones={[treeZone, labelsZone, msaZone]}
  />
</div>
```

## Live Ensembl example

The bundled Vite playground (`npm run dev`) has a "Load Ensembl tree" button that fetches a real gene tree (BRCA2 — `ENSG00000139618`), runs it through `fromEnsemblGeneTree`, and renders it pivoted to put human BRCA2 at the top. Demonstrates the entire stack against live data.

```ts
import { TBrowse } from 'tbrowse';
import { fromEnsemblGeneTree, computePivotState } from 'tbrowse-core';

const json = await fetch(
  'https://rest.ensembl.org/genetree/member/id/homo_sapiens/ENSG00000139618?aligned=1&sequence=protein',
  { headers: { Accept: 'application/json' } },
).then((r) => r.json());

const { tree, taxonomy, msa, geneMetadata } = fromEnsemblGeneTree(json);
```

### Choosing a REST endpoint

`rest.ensembl.org` intermittently sheds load with 5xx errors, which is fatal to a fan-out that issues one request per leaf. The playground therefore ships a **mirror picker** listing the current endpoint plus every live per-release archive host. Archive hosts pin one Ensembl release and run on separate infrastructure, so they stay responsive when the main endpoint does not. The default is `rest.ensembl.org` (the current release), so the playground shows current data; switch to an archive when the main endpoint is struggling.

One caveat if you hard-code a host yourself: the gene-tree member route changed shape mid-history.

| Release | Route |
| --- | --- |
| ≤ 109 | `/genetree/member/id/{gene}` |
| 110–111 | either form |
| ≥ 112 | `/genetree/member/id/{species}/{gene}` |

Sending the wrong form returns a 404, so the playground's URL builder switches on the selected release. Note that alignment width and leaf count differ between releases (BRCA2 is 174 leaves / 5471 columns on r112, 176 / 7138 on r105), so switching mirrors invalidates anything derived from the tree — the playground clears cached domains and gene structures on a switch.

All playground fetches go through a shared `fetchWithRetry` helper that retries 429 and 5xx with exponential backoff plus jitter, honouring `Retry-After` when present. The per-leaf fan-outs record individual failures and carry on rather than aborting the batch.

## Development

```sh
npm install
npm run dev         # Vite dev server (examples/playground)
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # library build to dist/
```

## Host inputs

```ts
interface TBrowseProps {
  tree: Tree;                          // required
  taxonomy?: Taxonomy;
  msa?: MSA;
  geneMetadata?: GeneMetadata;
  nodeAnnotations?: NodeAnnotation[];
  labelProviders?: LabelProvider[];

  zones: ZoneDefinition[];             // built-ins + plugins
  nodeOfInterest?: string;             // pivot the tree to this gene/node at mount

  // Controlled / uncontrolled view state
  viewState?: ViewState;
  initialViewState?: Partial<ViewState>;
  onViewStateChange?: (next: ViewState) => void;

  theme?: 'light' | 'dark';
  className?: string;
}
```

`Tree.nodes` is flat: `{ id, parentId, distance, isLeaf, taxonomyId?, geneId?, eventType?, bootstrap? }`. `MSA.sequences` is keyed by gene id. `taxonomyId` is `string | number` (gene trees carry numeric NCBI ids; a species tree keyed by `String(taxonId)` works unchanged). The Ensembl adapter (`fromEnsemblGeneTree`, in tbrowse-core) walks the nested REST response into this normalized shape.

## Data loading: tbrowse-core

`<TBrowse>` never fetches. Everything that turns a file or an API response into the props above lives in the companion package [`tbrowse-core`](./packages/core) — a dependency-free TypeScript library that also runs in Node:

| Subpath | What |
|---|---|
| `tbrowse-core` (root) | The data model types plus everything below. |
| `tbrowse-core/tree` | Children index, pre/post-order walks, leaf order with swaps, roll-ups (`sumLeafCounts`, `maximalExcludedClades`), pruning, `computePivotState`, `toNewick`, tree-model / hierarchy conversion, LCA, node heights, validation. |
| `tbrowse-core/parsers` | Newick, Nexus, PhyloXML (`parseTreeFile`) and CSV/TSV (`parseTableFile`). |
| `tbrowse-core/fetch` | `fetchWithRetry` (backoff + jitter + `Retry-After`), `getJson`, `buildUrl`, bounded `fanOut` with partial-failure accounting. |
| `tbrowse-core/sources` | The adapters (`fromEnsemblGeneTree`, `fromGrameneGenetree`, `fromBrAPIAlleleMatrix`, …), the `TreeDataSource` / `DataSlot` / `Loader` contract with `createLoader`, `extendSource`, `staticSource`, and the built-in sources `ensemblGeneTreeSource`, `grameneGeneTreeSource`, `brapiAlleleMatrixSource`, `fileTreeSource`. |
| `tbrowse-core/cluster` | UPGMA over genotype dosages (`upgma`, `upgmaFromCalls`, `dosagesFromGenotypeMatrix`). |
| `tbrowse-core/view` | `buildInitialViewState`, `applyPivot`, URL-hash codec, derived-prune layer, `computeVisibleRows` / `computeRowRange`. |
| `tbrowse-core/zone` | Row flags and leaf/taxon joins for host-defined zones (`rowsWithFlags` in tbrowse adds the theme colours). |

The viewer re-exports every type from the core, so a host can import `Tree` from either package. The core's own documentation: [README](./packages/core/README.md) (model diagram, complete entry-point table, a headless Node example), [Writing a data source](./packages/core/docs/data-sources.md), [Writing a zone with the row helpers](./packages/core/docs/zones.md) and the [API reference](./packages/core/docs/api/tbrowse-core.md) generated from the type declarations.

Two hooks wire a core data source to the component:

```tsx
import { TBrowse, treeZone, labelsZone, msaZone, useLoader, useInitialViewState } from 'tbrowse';
import { ensemblGeneTreeSource } from 'tbrowse-core';

const zones = [treeZone, labelsZone, msaZone];
const ctx = useMemo(() => ({ geneId }), [geneId]);
const { hostProps, snapshot, loader } = useLoader(ensemblGeneTreeSource, ctx, { zoneSlots: { msa: ['proteinDomains'] } });
const [viewState, setViewState] = useInitialViewState(zones, snapshot);
if (!hostProps || !viewState) return snapshot.error ?? 'Loading…';
return <TBrowse {...hostProps} zones={zones} viewState={viewState} onViewStateChange={setViewState} />;
```

`useLoader` restarts when `ctx` (or an explicit `key`) changes and exposes `loader.load('proteinDomains')` for lazy slots; `useInitialViewState` rebuilds the view when a root arrives ('reset' / 'soft' / 'keep' via `onRootReady`) and keeps the zone list in step.

## ViewState

The single serializable object that captures everything URL-shareable.

```ts
interface ViewState {
  selectedNodeId: NodeId | null;
  collapsedNodeIds: NodeId[];          // internal nodes shown as triangles
  prunedNodeIds: NodeId[];             // subtrees hidden + replaced with stub glyphs
  swappedNodeIds: NodeId[];            // internal nodes whose children render in reversed order
  compressedNodeIds: NodeId[];         // per-branch overrides of the auto branch-length compression
  nodeOfInterestId: NodeId | null;     // the pivoted leaf
  zones: { id: string; width: number; visible: boolean; userToggled?: boolean }[];
  zoneStates: Record<string, unknown>; // per-zone state slot (built-ins use well-known keys)
  rowHeight?: number;                  // Display control; falls back to the rowHeight prop
  fontSize?: number;                   // Display control; falls back to the fontSize prop
  unlinkedZoneGroups?: string[];       // exclusive groups the user decoupled
  search: { query: string; excludedFields?: string[]; caseSensitive?: boolean; regex?: boolean } | null;
}
```

`buildInitialViewState(zones, options)` from `tbrowse-core` produces one from a zone list (the same routine the chassis uses in uncontrolled mode), and `normalizeViewState` repairs a persisted blob from an older version.

All chassis interactions (resize, reorder, collapse via tooltip, prune via tooltip, swap, MSA pan/zoom, label-field picker, show/hide) write to this object via `onViewStateChange`. Persist it to a URL fragment for shareable views.

## Built-in zones

| Zone | Id | Default width |
|---|---|---|
| `treeZone` | `tree` | 280px |
| `labelsZone` | `labels` | 220px |
| `msaZone` | `msa` | 360px |

The Tree zone supports collapse/expand, prune/regrow, swap children, click-tooltip with contextual actions, internal-node event glyphs (speciation circle / duplication square), proportional-height collapsed-subtree triangles, and animated transitions. Labels supports a configurable field picker (gene id, gene name, gene description, scientific name, common name) plus optional async `LabelProvider` plug-ins. MSA renders a canvas alignment with a coverage minimap (drag-to-pan), wheel-driven pan + ctrl/shift-zoom, and four built-in color schemes (Plain, Clustal, Hydrophobicity, Nucleotide).

Custom zones implement `ZoneDefinition`:

```ts
interface ZoneDefinition<S = unknown> {
  id: string;
  displayName: string;
  Header: ComponentType<ZoneRenderProps<S>>;
  Body: ComponentType<ZoneRenderProps<S>>;
  defaultWidth: number;
  minWidth: number;
  defaultZoneState: S;
  isAvailable: (data: HostData) => boolean;
}
```

Both `Header` and `Body` receive the same `ZoneRenderProps`: `visibleRows` (already collapsed/pruned/swapped), virtualization `rowRange`, hover/select callbacks, the host's data, and per-zone state plumbing.

## Helpers

| Export | Package | What |
|---|---|---|
| `computeVisibleRows` | tbrowse-core | Pure derivation: `({ tree, collapsedNodeIds, prunedNodeIds, swappedNodeIds?, rowHeight? }) → VisibleRow[]`. |
| `computePivotState` | tbrowse-core | Resolve a gene id / node id and return collapse + swap sets that pivot the tree. |
| `buildInitialViewState` | tbrowse-core | Initial `ViewState` for a zone list (widths, visibility, exclusive groups, pivot). |
| `fromEnsemblGeneTree` | tbrowse-core | Convert Ensembl REST gene-tree JSON to TBrowse inputs. |
| `rowsWithFlags` | tbrowse | Rows in the virtualised range with hover/selection flags and theme background, for host-defined zone bodies. |
| `createStubZone` | tbrowse | Build a placeholder zone for development. |

The deprecated re-exports of the core helpers from `tbrowse` itself remain through 2.x.

## Bundle

ESM + CJS, types via `vite-plugin-dts`. Peer-deps on `react` / `react-dom` only; runtime deps on `zustand` and `tbrowse-core`. Current bundle ~14 kB gzipped (CJS).

## Project layout

```
src/                    the viewer (React)
  TBrowse.tsx, types.ts, store.tsx
  layout/               grid + virtualization + animation
  zones/
    tree/               SVG branches, glyphs, triangles, tooltip
    labels/             field picker, label-provider cache
    msa/                canvas paint, minimap, color schemes
    rows.ts             row prologue for host-defined zones
  *.test.ts             vitest unit tests
packages/core/          tbrowse-core (headless; npm workspace)
  src/types.ts          data model
  src/tree, parsers, fetch, adapters, view, zone
examples/playground/    Vite dev app (kitchen-sink demo)
scripts/                export-surface and packaging guards
```

Workspace commands: `npm run build:core` builds the core (also run automatically before `build` and `typecheck`), `npm run test:all` runs both suites, `npm run check:exports` verifies the 2.x export surface, `node scripts/smoke-core.mjs` packs and loads the core in an empty project.

## License

MIT.
