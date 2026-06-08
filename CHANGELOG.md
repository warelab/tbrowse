# Changelog

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
