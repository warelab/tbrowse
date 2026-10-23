# Writing a zone with the row helpers

A *zone* is a column the tbrowse viewer renders beside the tree, row-aligned with it: the built-in labels, MSA, neighbourhood and genome zones, or one a host defines for its own data (gramene-search's gene counts, genome bins and expression attributes). A zone is a `ZoneDefinition` from `tbrowse`:

```ts
interface ZoneDefinition<S = unknown> extends ZoneSpec<S> {   // ZoneSpec is tbrowse-core's pure half
  id: string;
  displayName: string;
  Header: ComponentType<ZoneRenderProps<S>>;
  Body: ComponentType<ZoneRenderProps<S>>;
  defaultWidth: number;          // fr share of the container width
  minWidth: number;              // px floor for the resize handle
  defaultZoneState: S;           // persisted per zone in ViewState.zoneStates[id]
  isAvailable: (data: HostData) => boolean;
  defaultVisible?: boolean;      // default true; false = hidden until its data arrives
  exclusiveGroup?: string;       // e.g. 'detail' to share the built-in MSA / neighbourhood / genome slot
}
```

The viewer owns layout, scrolling, hover and selection; `Header` and `Body` only paint. What a zone needs that does not depend on React — which rows to paint, where, with which highlight, and how to find its data for a row — is in `tbrowse-core/zone`, so a zone body is a short function and the arithmetic is tested once.

## What a zone receives

Both components get the same `ZoneRenderProps`. The ones a data zone uses:

| Prop | Meaning |
|---|---|
| `visibleRows: VisibleRow[]` | Every row of the current view, top to bottom: one per visible leaf (`kind: 'leaf'`) or collapsed clade (`kind: 'collapsedSummary'`), each with `nodeId`, `y`, `height`, `leafCount` and, during animations, `opacity`. Computed by `computeVisibleRows` from the tree and the view state's collapsed / pruned / swapped sets. |
| `rowRange: RowRange` | The half-open index window `[startIndex, endIndex)` of rows intersecting the scroll viewport, with overscan. Paint only these. |
| `width: number` | The zone's current pixel width. |
| `data: HostData` | The host's data: `tree`, `taxonomy`, the per-leaf maps, and the opaque `hostData` channel where a host-defined zone finds its own payload. |
| `hoveredNodeId`, `hoveredSubtreeIds`, `selectedNodeId` | The chassis hover / selection state shared by every zone. `hoveredSubtreeIds` is the hovered node plus its descendants. |
| `onHoverNode(id \| null)`, `onSelectNode(id)` | Report hover and clicks so the other zones (and the tree) light up the same row. |
| `zoneState`, `setZoneState` | The zone's slot in `ViewState.zoneStates`, typed by `S`. Use it for anything that should round-trip through a saved or shared view (a renamed header, a chosen column). |

The remaining props (`collapsedNodeIds`, `prunedNodeIds`, `swappedNodeIds`, `searchState`, `searchResults`, the `onToggle…` / `onReroot` / `onShowParalogs` callbacks) exist for zones that offer tree actions of their own.

## Rows

```ts
import { rowsInRange, rowFlags, rowsTotalHeight } from 'tbrowse-core/zone';
import { rowsWithFlags, rowHighlightBackground } from 'tbrowse';
```

| Helper | What it does |
|---|---|
| `rowsTotalHeight(rows)` | `last.y + last.height`, or 0. The height of the zone's body element, so the viewer's shared scroll container has the right extent. |
| `rowsInRange(rows, rowRange)` | `rows.slice(startIndex, endIndex)` — the rows to actually paint. |
| `rowFlags(row, { hoveredNodeId, hoveredSubtreeIds, selectedNodeId })` | `{ isSelected, isExactHover, isInHoveredSubtree }` for one row. An exactly hovered row has both hover flags set. |
| `rowHighlightBackground(flags)` *(tbrowse)* | The theme variable for those flags, in precedence order selected > exact hover > inside hovered subtree > `'transparent'`: `var(--tbrowse-row-select-bg)`, `var(--tbrowse-row-hover-bg)`, `var(--tbrowse-row-subtree-bg)`. |
| `rowsWithFlags(rows, rowRange, state)` *(tbrowse)* | The three above in one call: `[{ row, flags, background }]` for the rows in range. |

The core keeps the flags and the arithmetic; the colour vocabulary lives in `tbrowse` because it names the viewer's CSS variables. A body is therefore:

```jsx
const Body = ({ visibleRows, rowRange, width, data, hoveredNodeId, hoveredSubtreeIds, selectedNodeId, onHoverNode, onSelectNode }) => {
  const rows = rowsWithFlags(visibleRows, rowRange, { hoveredNodeId, hoveredSubtreeIds, selectedNodeId });
  return (
    <div style={{ position: 'relative', width, height: rowsTotalHeight(visibleRows) }}>
      {rows.map(({ row, background }) => (
        <div
          key={row.nodeId}
          onMouseEnter={() => onHoverNode(row.nodeId)}
          onMouseLeave={() => onHoverNode(null)}
          onClick={() => onSelectNode(row.nodeId)}
          style={{ position: 'absolute', top: row.y, height: row.height, left: 0, right: 0, background, opacity: row.opacity ?? 1 }}
        >
          {/* this row's cell(s) */}
        </div>
      ))}
    </div>
  );
};
```

Rows are absolutely positioned at `row.y` inside a body whose height is the total, never stacked in flow: the viewer scrolls every zone together and expects the same geometry from each. Key by `nodeId` (stable across collapses and animations), and honour `row.opacity` so rows fade with the tree's transitions.

## Finding a row's data

A row names a node; host data is usually keyed by something else. Re-key once, outside the render, with the join helpers:

| Helper | From → to | Notes |
|---|---|---|
| `leafNodeIdByGeneId(tree)` | `geneId → nodeId` for every leaf with a gene id | Later leaves win on duplicate gene ids. |
| `geneIdByLeafNodeId(tree)` | `nodeId → geneId` | The hover-readout map ("which gene is this row"). |
| `joinByLeaf(tree, byGeneId)` | `Record<GeneId, T> → { byNode: Record<NodeId, T>, unmatched: GeneId[] }` | Per-gene documents (Solr docs, API rows) onto leaf rows. Gene ids with no leaf are reported, not silently dropped. |
| `joinByTaxon(tree, byTaxonId)` | `Record<string, T> → { byNode, unmatched }` | Per-species values fan out to every node carrying that `taxonomyId` — each gene of the species in a gene tree, the one node per taxon in a species tree. Keys are compared as strings, so numeric and string taxon ids interoperate. |

Collapsed rows are the second half of the problem: a `collapsedSummary` row's `nodeId` is an internal node, and the zone has to show *something* for the clade it stands for. Roll the per-leaf values up the tree so one `byNode[row.nodeId]` lookup answers both kinds of row:

| Helper | Result per node |
|---|---|
| `countsFromFacet(tree, facet, key?)` | Leaf counts parsed from a Solr facet array `[id, count, id, count, …]`, summed up the tree. `key: 'nodeId'` (default) matches facet ids to leaf node ids — exactly gramene-search's `computeGeneCounts`; `key: 'taxonomyId'` matches `String(leaf.taxonomyId)`, which is what a gene tree faceted by `taxon_id` needs. |
| `sumByNode(tree, leafValues)` | Sum over the subtree (`leafValues[id] || 0` at leaves). |
| `maxByNode(tree, leafValues)` | Maximum over the subtree — a "peak" column. |
| `rollUp(tree, leafValue, combine)` *(tree)* | The general post-order fold the three above are built on, for anything else (a mean, a set union, a dominant category). |

## Worked example: gramene-search's counts zone

The taxonomic-distribution view in gramene-search shows the species tree beside a column with the number of search hits per genome, and the subtree total for a collapsed clade. Counts come from the search's `taxon_id` facet. The species tree is built with `fromTreeModel`, whose node ids are the taxon ids themselves, so the facet's ids match leaf node ids directly.

**The container** computes the per-node counts once per result set and hands them to the viewer through `hostData` (`src/components/results/TaxDistTbrowse.js`):

```js
import { buildInitialViewState, countsFromFacet, leavesFailing, pixelWidthsToFr } from 'tbrowse-core';

const hostData = useMemo(() => {
  const facet = props.grameneSearch?.facet_counts?.facet_fields?.taxon_id;   // [taxonId, count, taxonId, count, …]
  return {
    bins: extractGenomeData(grameneTaxDist),
    geneCounts: adapter ? countsFromFacet(adapter.tree, facet, 'nodeId') : null,   // { [nodeId]: count }, summed up the tree
    binsUI: binsUiRef.current,
    onApplyBinsFilter,
  };
}, [grameneTaxDist, adapter, props.grameneSearch, onApplyBinsFilter]);

// … <TBrowse tree={adapter.tree} taxonomy={adapter.taxonomy} hostData={hostData} zones={[treeZone, labelsZone, countsZone, binsZone]} … />
```

**The zone** (`src/components/results/taxTree/countsZone.js`, lightly abridged) paints one right-aligned number per row:

```jsx
import React from 'react';
import { EditableZoneName, rowsWithFlags } from 'tbrowse';
import { rowsTotalHeight } from 'tbrowse-core';

const CountsHeader = ({ zoneState, setZoneState }) => (
  <div style={{ padding: '0 10px', height: '100%', display: 'flex', alignItems: 'center', fontSize: 13 }}>
    <EditableZoneName
      defaultName="Genes"
      customName={zoneState?.name}
      onChange={(next) => setZoneState((s) => ({ ...(s ?? {}), name: next }))}
    />
  </div>
);

const CountsBody = ({
  visibleRows, rowRange, width, data,
  hoveredNodeId, hoveredSubtreeIds, selectedNodeId, onHoverNode, onSelectNode,
}) => {
  const totalHeight = rowsTotalHeight(visibleRows);
  const counts = (data.hostData && data.hostData.geneCounts) || {};
  // Rows in the virtualised range with the shared hover/select background, so
  // hovering any zone lights up the same row across all of them.
  const rows = rowsWithFlags(visibleRows, rowRange, { hoveredNodeId, hoveredSubtreeIds, selectedNodeId });

  return (
    <div style={{ position: 'relative', width, height: totalHeight }}>
      {rows.map(({ row: r, background }) => {
        const n = counts[r.nodeId];        // a leaf's count, or a collapsed clade's subtree total
        return (
          <div
            key={r.nodeId}
            onMouseEnter={() => onHoverNode(r.nodeId)}
            onMouseLeave={() => onHoverNode(null)}
            onClick={() => onSelectNode(r.nodeId)}
            style={{
              position: 'absolute', top: r.y, height: r.height, left: 0, right: 0,
              paddingRight: 8, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              boxSizing: 'border-box', fontSize: 'var(--tbrowse-font-size, 12px)',
              fontVariantNumeric: 'tabular-nums', color: 'var(--tbrowse-text)',
              background, cursor: 'pointer', opacity: r.opacity ?? 1,
            }}
          >
            {typeof n === 'number' ? n.toLocaleString() : ''}
          </div>
        );
      })}
    </div>
  );
};

export const countsZone = {
  id: 'counts',
  displayName: 'Genes',
  Header: CountsHeader,
  Body: CountsBody,
  defaultWidth: 12,
  minWidth: 64,
  defaultZoneState: {},
  isAvailable: (data) => Boolean(data.hostData && data.hostData.geneCounts),
  defaultVisible: true,
};
```

What each helper buys here:

- `countsFromFacet` in the container turns the flat facet into a per-node map **including internal nodes**, so the body never walks the tree: collapsed rows read their total with the same lookup as leaves. Before the helpers, this was a private `computeGeneCounts` in the zone file; the core's version is tested against the original's output.
- `rowsTotalHeight` sizes the body; `rowsWithFlags` restricts painting to the viewport and gives each row the theme background for the chassis's hover and selection.
- Reading from `data.hostData.geneCounts` keeps the viewer ignorant of the payload's shape, and `isAvailable` hides the zone until the container has produced it.
- `EditableZoneName` (from `tbrowse`) plus `zoneState.name` lets the user rename the column, and the name persists with the view because it lives in `ViewState.zoneStates.counts`.

## A second example: per-gene documents onto a gene tree

gramene-search's expression zone shows a gene × organ heat map for a gene tree. Its documents are keyed by gene id, so the shaping step (run once, in the data slot described in [data-sources.md](./data-sources.md)) joins them to rows and precomputes the hover readout (`src/components/results/details/exprAttrsZone.js`):

```js
import { geneIdByLeafNodeId, joinByLeaf, rowsTotalHeight } from 'tbrowse-core';

export function buildExprData(docs, tree) {
  const nodeGene = geneIdByLeafNodeId(tree);                 // leaf nodeId → gene id, for the header readout
  const byGeneId = {};
  for (const d of docs) if (d && d.id) byGeneId[d.id] = extractExprAttrs(d);
  const byNode = joinByLeaf(tree, byGeneId).byNode;          // docs whose gene is not a leaf here are dropped
  // … organ union, TPM range …
  return { organs, byNode, nodeGene, maxTpm };
}
```

The body then does `const gene = byNode[r.nodeId]` per row, and the header shows `nodeGene[hoveredNodeId]`. Because the zone's data arrives asynchronously it declares `defaultVisible: false` and `isAvailable: (data) => Boolean(data.hostData?.exprAttrs?.organs?.length)`; the viewer reveals it the first time its data lands, unless the user has toggled it. It joins the built-in `exclusiveGroup: 'detail'`, so it shares the wide per-leaf slot with the MSA, neighbourhood and genome zones.

## Declaring the zone to the view state

Because `ZoneDefinition` satisfies the core's `ZoneSpec`, the same zone list drives `buildInitialViewState`:

```js
import { buildInitialViewState, pixelWidthsToFr } from 'tbrowse-core/view';

const ZONES = [treeZone, labelsZone, countsZone, binsZone];
const initial = buildInitialViewState(ZONES, {
  widths: { tree: 30, labels: 22, counts: 10, bins: 60 },        // fr shares
  overrides: { zoneStates: { tree: { layoutMode: 'cladogram', showLeafExtensions: false }, labels: { visibleFields: ['taxonomy.commonName'] }, counts: {}, bins: {} } },
});
// Pixel targets instead of shares: give three zones fixed widths and let the fourth absorb the rest.
const widths = pixelWidthsToFr({ tree: 270, labels: 200, counts: 64 }, containerPx, 'bins', 160);
```

`defaultVisible`, `isAvailable` and `exclusiveGroup` decide each zone's initial visibility (the first available member of a group claims it); `defaultZoneState` seeds `zoneStates[id]`. A persisted view goes through `normalizeViewState(blob, ZONES)` so new zones get an entry and removed ones lose theirs.

## Loading status

When a zone's data comes from a loader slot, map the zone id to the slot in `createLoader`'s `zoneSlots` and spread `hostPropsFrom(snapshot)` onto the viewer: the `zoneStatus` prop then shows a spinner or an error glyph in that zone's header while the slot is loading or failed. Slots never name zones; see [data-sources.md](./data-sources.md#zoneslots-from-slot-status-to-zone-status).

## Checklist

- Body: `position: relative`, `height: rowsTotalHeight(visibleRows)`; rows `position: absolute` at `row.y` / `row.height`; key by `row.nodeId`; honour `row.opacity`.
- Paint only `rowsWithFlags(visibleRows, rowRange, …)` (or `rowsInRange` + `rowFlags` + your own colours).
- Call `onHoverNode` / `onSelectNode` so the highlight is shared with the tree and the other zones.
- Re-key data by node id **once** (`joinByLeaf`, `joinByTaxon`, `countsFromFacet`), outside the render; roll values up so collapsed rows have an answer.
- Read the payload from `data.hostData.<key>`; gate with `isAvailable`; `defaultVisible: false` for data that arrives late.
- Keep user-facing settings in `zoneState`, not in component state, so they survive a saved or shared view.
