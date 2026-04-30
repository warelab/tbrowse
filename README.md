# tbrowse

Embeddable React component for visualizing phylogenetic trees with pluggable data zones.

`<TBrowse>` renders a tree alongside a row-aligned set of zones (Tree, Labels, MSA, custom plug-ins). Tree topology, taxonomy, MSA, gene metadata, and per-node annotations are independent host inputs — TBrowse does no fetching of its own. View state (selection, collapse, prune, swap, zone widths, MSA viewport, search) is a single serializable object that round-trips through URL state via the controlled `viewState` / `onViewStateChange` props.

## Status

Library rewrite on the `rewrite` branch. The previous nwb / React 16 / Redux-Toolkit implementation is preserved at commit `b017a74` on `master`; the half-finished migration to React 18 + grid layout is parked on `wip/grid-migration`.

This rewrite is functionally complete for v1: chassis, three real zones (Tree / Labels / MSA), an Ensembl REST adapter, animated transitions, and a `nodeOfInterest` pivot.

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

The bundled Vite playground (`npm run dev`) has a "Load Ensembl tree" button that fetches a real gene tree (BRCA2 — `ENSG00000139618`) from `rest.ensembl.org`, runs it through `fromEnsemblGeneTree`, and renders it pivoted to put human BRCA2 at the top. Demonstrates the entire stack against live data.

```ts
import { fromEnsemblGeneTree, computePivotState, TBrowse } from 'tbrowse';

const json = await fetch(
  'https://rest.ensembl.org/genetree/member/id/homo_sapiens/ENSG00000139618?aligned=1&sequence=protein',
  { headers: { Accept: 'application/json' } },
).then((r) => r.json());

const { tree, taxonomy, msa, geneMetadata } = fromEnsemblGeneTree(json);
```

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

`Tree.nodes` is flat: `{ id, parentId, distance, isLeaf, taxonomyId?, geneId?, eventType?, bootstrap? }`. `MSA.sequences` is keyed by gene id. The Ensembl adapter (`fromEnsemblGeneTree`) walks the nested REST response into this normalized shape.

## ViewState

The single serializable object that captures everything URL-shareable.

```ts
interface ViewState {
  selectedNodeId: NodeId | null;
  collapsedNodeIds: NodeId[];          // internal nodes shown as triangles
  prunedNodeIds: NodeId[];             // subtrees hidden + replaced with stub glyphs
  swappedNodeIds: NodeId[];            // internal nodes whose children render in reversed order
  zones: { id: string; width: number; visible: boolean }[];
  zoneStates: Record<string, unknown>; // per-zone state slot (built-ins use well-known keys)
  search: { field: string; query: string } | null;
}
```

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

| Export | What |
|---|---|
| `computeVisibleRows` | Pure derivation: `(tree, collapsed, pruned, swapped) → VisibleRow[]`. |
| `computeTreeLayout` | Pure phylogram layout against a column width. |
| `computePivotState` | Resolve a gene id / node id and return collapse + swap sets that pivot the tree. |
| `fromEnsemblGeneTree` | Convert Ensembl REST gene-tree JSON to TBrowse inputs. |
| `createStubZone` | Build a placeholder zone for development. |

## Bundle

ESM + CJS, types via `vite-plugin-dts`. Peer-deps on `react` / `react-dom` only; runtime dep on `zustand`. Current bundle ~14 kB gzipped (CJS).

## Project layout

```
src/
  TBrowse.tsx, types.ts, store.tsx, treeIndex.ts
  visibleRows.ts        chassis row derivation
  pivot.ts              nodeOfInterest helper
  layout/               grid + virtualization + animation
  zones/
    tree/               SVG branches, glyphs, triangles, tooltip
    labels/             field picker, label-provider cache
    msa/                canvas paint, minimap, color schemes
  adapters/
    ensembl.ts          Ensembl REST → TBrowse inputs
  *.test.ts             vitest unit tests
examples/playground/    Vite dev app (kitchen-sink demo)
```

## License

MIT.
