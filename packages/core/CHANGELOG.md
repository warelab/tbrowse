# Changelog

## 1.0.0

The public surface is frozen: this is the version cited by the tbrowse application note. No runtime change from 0.2.0 — the release is documentation plus the version number. From here, additions arrive in minors and removals only in 2.0.

- README rewritten around a model diagram (tree, taxonomy, per-leaf maps and `hostData` → rows → zones), an entry-point table that lists every runtime export of every subpath, and a Node example that fetches a Gramene gene tree through `createLoader(grameneGeneTreeSource)`, prunes it with `pruneToLeaves` and writes Newick with `toNewick` (`examples/gramene-newick.mjs`; its real output against `data.gramene.org/v69` is in the README).
- `docs/data-sources.md`, "Writing a data source": the `TreeDataSource` / `DataSlot` / `Loader` contract member by member, `zoneSlots` and `zoneStatusOf`, the `itemErrorsOf` / `failWhen` / `patchMeta` hooks, `extendSource` / `staticSource`, the generation, abort, isolation, merge-order and reference-stability rules, with gramene-search's `exprAttrs` slot (Homology panel) as the worked example and a from-scratch source.
- `docs/zones.md`, "Writing a zone with the row helpers": `rowFlags`, `rowsInRange`, `rowsTotalHeight` (and tbrowse's `rowsWithFlags` / `rowHighlightBackground` on top of them), `joinByLeaf` / `joinByTaxon` / `leafNodeIdByGeneId` / `geneIdByLeafNodeId`, `countsFromFacet` / `sumByNode` / `maxByNode` / `rollUp`, with gramene-search's counts zone and expression zone as the examples.
- `docs/api/`: an API reference generated from the built declaration files, one page per entry point (`npm run docs:api`). `node scripts/gen-api-docs.mjs --check` (also `npm run check:docs`, and part of `prepublishOnly`) fails when the pages or the README entry-point table disagree with `dist/*.d.ts`.
- Compatibility, restated for the freeze: `TaxonomyId` is `string | number` and `Taxonomy` is keyed by `string` (widened in 0.1.0 / tbrowse 2.11.0; a TypeScript host passing `node.taxonomyId` to a `number` parameter needs a cast). The names the tbrowse 2.x viewer imports from the core (`scripts/surface-used-by-tbrowse.txt`, 101 names, checked on every build) stay exported throughout 1.x, so the viewer's `>=0.1.0 <2.0.0` range remains valid. The deprecated re-exports of core functions from `tbrowse` (`fromEnsembl*`, `fromGramene*`, `computePivotState`, `computeVisibleRows`, `computeRowRange`, `LEAF_ROW_HEIGHT`, `SUMMARY_ROW_HEIGHT`) are the viewer's concern and go away in tbrowse 3.0; the core exports them unchanged.

## 0.2.0

- `sources`: the data-source contract (`TreeDataSource` / `DataSlot` / `Loader` / `LoaderSnapshot`), `createLoader` (retry-wrapped fetch, eager and lazy slots, per-slot status and progress, per-item errors, `failWhen`, `patchMeta`, generation-guarded restarts, referentially stable snapshots, `zoneSlots` → per-zone status), `hostPropsFrom`, `mergeHostData`, `zoneStatusOf`, `defineSlot`, `extendSource`, `staticSource`.
- Built-in sources: `ensemblGeneTreeSource` (gene tree; lazy `proteinDomains` and `overlap` slots with bounded fan-out and partial-failure accounting), `grameneGeneTreeSource` (genes → genetrees, or a host-supplied `rawGenetree`; `neighborhood` and `geneStructures` slots), `brapiAlleleMatrixSource` (BrAPI v2 allele matrix with the server's Newick + leaf order, or a UPGMA/star fallback; `germplasm` and `variants` slots), `fileTreeSource` (Newick / Nexus / PhyloXML text or File). Plus the fetch helpers behind them (`fetchEnsemblGeneTree`, `fetchEnsemblProteinDomains`, `fetchEnsemblOverlap`, `fetchGrameneGene`, `fetchGrameneGenetree`, `fetchGrameneNeighborhood`, `fetchGrameneGeneStructures`, `fetchGrameneSearchDocs`, `fetchGrameneExprAttrDocs`, `facetPairsToCounts`, `fetchBrapiAlleleMatrix`, `fetchBrapiGermplasm`, `fetchBrapiVariants`, `fetchBrapiVariantSetTree`, `brapiPages`, `brapiBaseOf`, `brapiVariantsUrlFrom`).
- `adapters`: `fromBrAPIAlleleMatrix`, `fromBrAPIGermplasm` (from the tbrowse BrAPI prototype), `fromBrAPIVariants`, `mergeVariantSites` (joined by position), `fromBrAPITree` (Newick + server leaf order → tree + swaps).
- `cluster`: `upgma`, `upgmaFromCalls`, `distanceMatrix`, `dosagesFromCalls`, `dosagesFromGenotypeMatrix` — gramene-g2p's UPGMA lifted verbatim, producing a flat `Tree` with synthetic node ids and the sample name in `geneId`; `toNewick` of the result is byte-identical to g2p's serializer.
- `parsers`: `parseNewick` gains `labelsAsIds: false` (synthetic node ids, labels only in `geneId`), used by `fromBrAPITree`.
- `genotype`: `decodeCall`, `averageDosage`, `colorForCall`, `colorForAverageDosage` (from the genotype zone prototype).

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
