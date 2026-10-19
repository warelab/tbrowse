# tbrowse-core

The headless half of [tbrowse](https://tbrowse.org): the data model, tree algorithms, file parsers, REST adapters, fetch helpers and view-state logic that prepare data for the `<TBrowse>` React viewer — usable without the viewer, in a browser or in Node.

```sh
npm install tbrowse-core
```

Zero runtime dependencies. ESM and CommonJS builds with type declarations; Node ≥ 18 or any browser with `fetch`.

## Entry points

| Import | Contents |
|---|---|
| `tbrowse-core` | Everything below, plus the data model types. |
| `tbrowse-core/tree` | `buildChildrenIndex`, `preorder` / `postorder` / `leafOrder`, `rollUp` / `sumLeafCounts` / `maximalExcludedClades` / `leavesFailing`, `pruneToLeaves`, `subtree`, `computePivotState`, `toNewick`, `fromTreeModel` / `fromHierarchy`, `swapsForLeafOrder`, `lca`, `pathToRoot`, `nodeHeights`, `validateTree`. |
| `tbrowse-core/parsers` | `parseTreeFile` (Newick, Nexus, PhyloXML), `parseNewick`, `parseTableFile` (CSV/TSV). |
| `tbrowse-core/fetch` | `fetchWithRetry`, `withRetry`, `getJson`, `HttpError`, `buildUrl`, `fanOut`, `fanOutChunks`. |
| `tbrowse-core/sources` | Ensembl and Gramene adapters (`fromEnsemblGeneTree`, `fromGrameneGenetree`, …). Data-source loaders arrive in 0.2. |
| `tbrowse-core/view` | `buildInitialViewState`, `applyPivot`, `normalizeViewState`, `encodeHashState` / `decodeHashState`, `createDerivedPruneLayer`, `computeVisibleRows`, `computeRowRange`. |
| `tbrowse-core/zone` | Helpers for host-defined zones: `rowFlags`, `rowsTotalHeight`, `joinByLeaf`, `joinByTaxon`, `countsFromFacet`. |

## The model

A tree is flat: `{ rootId, nodes: Record<NodeId, { id, parentId, distance, isLeaf, taxonomyId?, geneId? }> }`. Child order is the insertion order of `nodes`. Per-leaf data (`MSA.sequences`, `proteinDomains`, `neighborhood`, `geneStructures`, `germplasm`, …) is keyed by the leaf's `geneId`; per-taxon data by `String(taxonomyId)`.

```ts
import { parseNewick } from 'tbrowse-core/parsers';
import { leafOrder, toNewick, pruneToLeaves } from 'tbrowse-core/tree';

const { tree } = parseNewick('((A:0.1,B:0.2):0.05,C:0.3);');
leafOrder(tree);                       // ['A', 'B', 'C']
toNewick(pruneToLeaves(tree, new Set(['A', 'C']))!);
```

```ts
import { fetchWithRetry } from 'tbrowse-core/fetch';
import { fromEnsemblGeneTree } from 'tbrowse-core';
import { buildInitialViewState, applyPivot } from 'tbrowse-core/view';
import { computePivotState } from 'tbrowse-core/tree';

const json = await (await fetchWithRetry(
  'https://rest.ensembl.org/genetree/member/id/homo_sapiens/ENSG00000139618?aligned=1&sequence=protein',
  { headers: { Accept: 'application/json' } },
)).json();
const { tree, taxonomy, msa, geneMetadata } = fromEnsemblGeneTree(json);
const viewState = applyPivot(buildInitialViewState(zones), computePivotState(tree, 'ENSG00000139618'));
```

## Relationship to tbrowse

`tbrowse` depends on `tbrowse-core` and re-exports every type, so `import type { Tree } from 'tbrowse'` and `import type { Tree } from 'tbrowse-core'` name the same type. The viewer's `ZoneDefinition` extends the core's `ZoneSpec`, so a zone list can be handed to `buildInitialViewState` directly.

## License

MIT.
