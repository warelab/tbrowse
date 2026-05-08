# Contributing

## Prerequisites

[Node.js](https://nodejs.org/) ≥ 18 (Vite 5 requires it). React 18+ and
react-dom 18+ are pulled in as peer-dev dependencies; hosts of the
published package supply their own.

## Installation

```sh
npm install
```

## Playground

A Vite-served playground in `examples/playground/` exercises the live
library against sample data plus the Ensembl, Gramene, and arbitrary
Newick / Nexus / PhyloXML uploads.

```sh
npm run dev               # serves at http://localhost:5173
npm run build:playground  # static bundle in dist-playground/
npm run preview:playground
```

The playground imports `tbrowse` directly from `src/`, so changes to
the library are reflected instantly via HMR.

## Tests

```sh
npm test          # run the Vitest suite once
npm run test:watch
```

Tests live next to the code they cover (`*.test.ts`). The suite
focuses on pure helpers — pivot, layout, search, parsers, adapters.
Renderer code is exercised by hand in the playground.

## Type-check

```sh
npm run typecheck
```

## Building the library

```sh
npm run build
```

Vite library mode produces ESM (`dist/tbrowse.js`), CJS
(`dist/tbrowse.cjs`), and a bundled `dist/index.d.ts`. `react` and
`react-dom` stay external; only `zustand` is bundled.

`npm run prepublishOnly` chains `rm -rf dist && build && typecheck &&
test` — `npm publish` runs it automatically.

## Project layout

```
src/
  TBrowse.tsx            # public entry component
  store.tsx              # zustand store, scoped via context
  layout/                # toolbar, search bar, zone grid
  zones/
    tree/                # phylogeny renderer
    labels/              # per-leaf label fields
    msa/                 # MSA + minimap + masking
    neighborhood/        # ±10 flanking genes
    genome/              # exon / intron / feature track
    table/               # createTableZone() factory
    EditableZoneName.tsx # shared zone-header rename control
  adapters/              # Ensembl + Gramene normalisation
  search/                # search field registry + matcher
  icons/                 # inline SVG (gear, wordmark)

examples/playground/     # the Vite host app
```

## Pull requests

- Branch from `master`, keep the diff focused, and run `npm run
  typecheck && npm test` before pushing.
- Public API additions (props on `<TBrowse>`, exports from
  `src/index.ts`, zone-state interfaces) should preserve backwards
  compatibility unless the change is part of an explicit major bump
  agreed with maintainers.
- Stick to the existing comment style: explain *why*, not what — see
  any of the zone implementations for examples.
- No emojis in code or docs unless the surrounding file already uses
  them.

## Releasing (maintainers)

```sh
npm version <patch | minor | major>   # bumps + tags
npm publish                           # runs prepublishOnly
git push && git push --tags
```

A minor bump is appropriate for new zones, new public exports, or
new optional fields on existing types. Patch bumps for bug fixes and
internal-only changes.
