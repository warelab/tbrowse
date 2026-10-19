# Changelog

## 2.12.0

### Data loading
- `useLoader(source, ctx, { key?, zoneSlots?, … })` runs a tbrowse-core `TreeDataSource` and returns `{ snapshot, loader, hostProps }`; spread `hostProps` onto `<TBrowse>` (it includes `zoneStatus`). `useInitialViewState(zones, snapshot, { initial?, onRootReady?, … })` keeps a controlled `ViewState` in step with the loader ('reset' / 'soft' / 'keep' per root).

### Zones
- `createGenotypeMatrixZone({ id, matrix, … })`: a genotype-matrix zone (variants × leaves, dosage heatmap with allele text when zoomed, consensus row for collapsed clades, phasing toggle), landed from the BrAPI prototype branch. Joins the matrix to leaves by `geneId`.
- Labels zone: `germplasm.*` built-in fields (id, name, species, crop, accession, pedigree, country) read `TBrowseProps.germplasm`.

### Playground
- Every data path (sample, Ensembl, Gramene, uploaded file, BrAPI) runs through a core data source and the two hooks; the `/brapi` dev proxy (`BRAPI_PROXY_TARGET`, default `http://localhost:8080`) targets a gramene-g2p API.

## 2.11.0

### tbrowse-core
- The headless half of tbrowse now lives in its own package, `tbrowse-core`
  (`packages/core` in this repo; published separately, zero runtime
  dependencies, runs in Node and browsers): the data model types, tree
  algorithms (children index, walks, roll-ups, pruning, pivot, Newick
  serialisation, tree-model conversion), the Newick / Nexus / PhyloXML and
  CSV/TSV parsers that used to be private to the playground, the Ensembl and
  Gramene REST adapters, `fetchWithRetry` + bounded fan-out, view-state
  helpers (`buildInitialViewState`, URL-hash codec, derived-prune layer,
  `computeVisibleRows` / `computeRowRange`) and pure row/join helpers for
  host-defined zones. tbrowse depends on it (`>=0.1.0 <2.0.0`).
- Every data-model type is re-exported unchanged, so `import type { Tree }
  from 'tbrowse'` keeps working and names the same type as the core's.
- `fromEnsembl*`, `fromGramene*`, `computePivotState`, `computeVisibleRows`,
  `computeRowRange`, `LEAF_ROW_HEIGHT` and `SUMMARY_ROW_HEIGHT` are still
  exported from tbrowse but marked `@deprecated`; import them from
  `tbrowse-core`. The function re-exports go away in tbrowse 3.0.
- New exports: `rowHighlightBackground` and `rowsWithFlags` (the row prologue
  every host-defined zone used to copy), and the types `ZoneSpec`,
  `ZoneStatus`, `ZoneStatusMap`, `HostDataPatch`, `Germplasm`,
  `VariantSite`, `GenotypeMatrix`.
- `TaxonomyId` widened from `number` to `string | number` and `Taxonomy` is
  keyed by `string` (a JS object is string-keyed at runtime anyway). No code
  in the viewer changes; a TypeScript host passing `node.taxonomyId` to a
  `number` parameter now needs a cast.
- `TBrowseProps.zoneStatus` is typed as `ZoneStatusMap` (same shape).
- `ZoneDefinition` now extends the core's `ZoneSpec`; nothing changes for
  zone authors.

### Playground
- The tree and table parsers, Ensembl mirror table, retry helper and URL-hash
  codec are imported from `tbrowse-core` (and are now type-checked and
  tested there). `npm run typecheck:playground` type-checks the playground.

## 2.10.0

### MSA
- Hovered-residue readout in the zone header (gene, 1-based residue position,
  residue) with the hovered glyph drawn bold in the body.

## 2.9.2
- Fix the MSA config popover when the chassis is fullscreen.
- Spelling: "color" (was "colour") in user-facing labels.

## 2.9.1
- Widen the Display control ranges: row height 8–64 px, font size 8–36 px.

## 2.9.0

### Toolbar
- Built-in "Display" toolbar section with row-height and font-size sliders,
  writing `ViewState.rowHeight` / `ViewState.fontSize` so the chosen density
  round-trips through a controlled or persisted view state. Opt in with
  `densityControls`.

## 2.8.0

### Zones
- Mutually-exclusive zone groups: zones sharing an `exclusiveGroup` id render
  as one segmented control in the Zones panel and only one is visible at a
  time; a link toggle decouples the group (persisted in
  `ViewState.unlinkedZoneGroups`). The built-in detail zones use the group
  `'detail'`.

## 2.7.0

### Tree
- Spine compression: any maximal run of single-visible-child internal nodes (the long "ladders" left behind when a tree is pruned down to a sparse leaf set) now collapses to a fixed-width segment drawn as a short pipe glyph, with the run's pruned branches merged into a single stub marker instead of one per rung. Generalizes the existing root-path compression to interior runs; gated on the same `rerootCompression` flag and only active when pruning actually creates such runs. Exported pure helper `compressSpines`.
- Halved the compressed-path pipe-glyph height for a more subtle mark.

## 2.0.0

Complete rewrite. Not backwards-compatible with the 1.x line.

### Stack
- React 18 + TypeScript + Zustand (was React 16 + Redux-Toolkit + nwb).
- Vite library build emitting ESM + CJS + bundled `.d.ts`. Gzipped ESM ~40 KB; previously ~12 MB unpacked.
- Single runtime dep: `zustand`. `react` and `react-dom` are peer deps.

### API
The host renders a single `<TBrowse>` component and supplies tree topology, taxonomy, MSA, gene metadata, and per-node annotations as independent inputs. View state (selection, collapse, prune, swap, zone widths, MSA viewport, search, neighborhood flips and gap toggles) is a single serializable object that round-trips through `viewState` / `onViewStateChange` for URL persistence.

Built-in zones, all individually exported:
- `treeZone` — tree drawing with branch-length compression, node-of-interest pivot, prune / regrow / reroot.
- `labelsZone` — pluggable per-leaf label fields.
- `msaZone` — virtualised MSA with multiple coloring schemes, protein-domain annotations, splice-junction marks.
- `neighborhoodZone` — ±10 flanking genes per leaf, family-coloured rainbow gradient seeded by the node-of-interest, intergenic-gap compression, click tooltips, half-height stacking for opposite-strand overlaps.

Adapters:
- `fromEnsemblGeneTree`, `fromEnsemblProteinFeatures` — Ensembl REST.
- `fromGrameneGene`, `fromGrameneGenetree`, `fromGrameneNeighborhood` — Gramene Solr graph.

### Migration from 1.x
Anyone on `tbrowse@1.x` should pin to `^1.0` and migrate gradually; the 2.0 component cannot be dropped in over the old one. The 1.x source is preserved at commit `b017a74` for archival reference.
