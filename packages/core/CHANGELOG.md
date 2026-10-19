# Changelog

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
