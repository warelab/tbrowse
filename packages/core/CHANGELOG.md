# Changelog

## 0.1.0

First release, extracted from tbrowse 2.10 and its playground.

- `types`: the tbrowse data model (`Tree`, `Taxonomy`, `MSA`, `HostData`, `ViewState`, …) plus `ZoneSpec`, `ZoneStatusMap`, `HostDataPatch`, `Germplasm`, `VariantSite`, `GenotypeMatrix`. `TaxonomyId` is `string | number`.
- `tree`: children index, walks, leaf order with swaps, roll-ups (`sumLeafCounts`, `maximalExcludedClades`, `leavesFailing`), `pruneToLeaves`, `computePivotState`, `toNewick`, `fromTreeModel` / `fromHierarchy`, `swapsForLeafOrder`, `lca`, `nodeHeights`, `validateTree`.
- `parsers`: `parseTreeFile` (Newick, Nexus, PhyloXML with an injectable XML parser), `parseTableFile` (CSV/TSV).
- `fetch`: `fetchWithRetry`, `getJson`, `buildUrl`, `fanOut` / `fanOutChunks`.
- `adapters` (exported from the root and `tbrowse-core/sources`): Ensembl REST and Gramene adapters moved verbatim from tbrowse.
- `view`: `buildInitialViewState`, `applyPivot`, `softResetForNewTree`, `normalizeViewState`, URL-hash codec, derived-prune layer, `computeVisibleRows`, `computeRowRange`.
- `zone`: `rowFlags`, `rowsTotalHeight`, `rowsInRange`, `joinByLeaf`, `joinByTaxon`, `countsFromFacet`, `sumByNode`, `maxByNode`.
- `table`: table column/data types and subtree aggregators.
