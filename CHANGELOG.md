# Changelog

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
