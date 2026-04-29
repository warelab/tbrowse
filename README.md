# tbrowse

Embeddable React component for visualizing phylogenetic trees with pluggable data zones.

A `<TBrowse>` instance renders one tree alongside one or more configurable zones (labels, MSA, custom). Tree topology, taxonomy, MSA, gene metadata, and node annotations are independent host-provided inputs — TBrowse does no data fetching of its own.

## Status

Pre-alpha. The package is being rewritten from scratch on the `rewrite` branch. The previous nwb / React 16 / Redux-Toolkit implementation is preserved at tag-equivalent commit `b017a74` on `master`, with an in-progress migration parked on `wip/grid-migration`.

## Development

```sh
npm install
npm run dev         # vite dev server, mounts examples/playground
npm run typecheck   # tsc --noEmit
npm run build       # library build to dist/
```

## Project layout

```
src/                  library source
  types.ts            host-facing API (Tree, MSA, ViewState, ZoneDefinition, …)
  TBrowse.tsx         <TBrowse> entry component
  store.tsx           zustand store + context
  visibleRows.ts      pure derivation: tree + collapsed/pruned → visible rows
examples/playground/  vite dev app
```
