# Writing a data source

A *data source* tells `tbrowse-core` how to turn a context (a gene id, a URL, a dropped file) into the tree and the per-leaf data the viewer draws, in pieces that load independently. The pieces are:

| Object | Role |
|---|---|
| `TreeDataSource<Ctx, M>` | `loadRoot(ctx)` → the tree and whatever arrived with it; `slots` → the independently loaded extras. |
| `DataSlot<T, Ctx, M>` | One extra: how to fetch it (`run`), when (`mode`, `enabled`), and how it becomes `HostData` (`toHostData`), plus optional hooks for partial failure and metadata. |
| `Loader<Ctx, M>` | Runs a source: `start(ctx)`, `load(slotId)`, `abort()`, `dispose()`, and a `LoaderSnapshot` that React subscribes to or a script awaits. |

Everything is exported from `tbrowse-core/sources` (and from the root). The built-in sources — `ensemblGeneTreeSource`, `grameneGeneTreeSource`, `brapiAlleleMatrixSource`, `fileTreeSource` — are written against exactly this contract, so their source files are the fullest examples.

```text
  loader.start(ctx)
     │  aborts the previous generation, resets the snapshot (generation + 1)
     ▼
  source.loadRoot({ ctx, fetch, signal })  ──▶  RootResult { tree, taxonomy?, nodeOfInterest?, data?, meta }
     │                                             snapshot.status 'ready', tree, root, data = root.data, pivot
     ▼
  every slot with mode ≠ 'lazy' and enabled(ctx, root) ≠ false, concurrently:
     slot.run({ ctx, fetch, signal, tree, root, onProgress, concurrency? })  ──▶  value
       itemErrorsOf(value)  → per-item failures recorded, slot still 'ready'
       failWhen(value, itemErrors) → a message makes the slot 'error' (value kept)
       patchMeta(value, meta, root) → a new meta replaces snapshot.root
       toHostData(value, root) → merged into snapshot.data in slot declaration order
     snapshot.zoneStatus = zoneStatusOf(snapshot.slots, options.zoneSlots)

  loader.load('slotId')   runs a lazy slot, or retries an errored one
```

## The contract

### `TreeDataSource<Ctx, M>`

```ts
interface TreeDataSource<Ctx = unknown, M = Record<string, unknown>> {
  id: string;
  label?: string;
  loadRoot(rc: RootContext<Ctx>): Promise<RootResult<M>>;
  slots: readonly DataSlot<any, Ctx, M>[];
}
```

`Ctx` is whatever the host passes to `start()`; `M` is the source's own typed metadata (`RootResult.meta`), the place for things that are neither host data nor the tree: a tree id, a gene-to-protein map, a genotype matrix. `loadRoot` receives `{ ctx, fetch, signal }` where `fetch` is already retry-wrapped and `signal` aborts when the loader restarts or is disposed. Throwing (or rejecting) from `loadRoot` puts the snapshot in `status: 'error'` with the message.

### `RootResult<M>`

```ts
interface RootResult<M> {
  tree: Tree;
  taxonomy?: Taxonomy;
  nodeOfInterest?: string;   // gene id or node id; the loader computes snapshot.pivot from it
  data?: HostDataPatch;      // msa, geneMetadata, proteinDomains, … that came with the tree
  meta: M;
}
```

Put in `data` whatever the root response already contained: the Gramene genetree document carries the MSA, gene metadata, protein domains and exon junctions, so `grameneGeneTreeSource` returns all of them from `loadRoot` and only the neighbourhood and gene structures are slots. Anything a zone will read from `root.meta` (the BrAPI source keeps the `GenotypeMatrix` there) must be typed in `M`.

### `DataSlot<T, Ctx, M>`

```ts
interface DataSlot<T, Ctx, M> {
  id: string;
  mode?: 'eager' | 'lazy';                                   // default 'eager'
  enabled?: (ctx: Ctx, root: RootResult<M>) => boolean;      // eager slots only; checked once per start()
  run(sc: SlotContext<Ctx, M>): Promise<T>;
  toHostData(value: T, root: RootResult<M>): HostDataPatch;
  itemErrorsOf?(value: T): Record<string, string> | null;
  failWhen?(value: T, itemErrors: Record<string, string> | null): string | null;
  patchMeta?(value: T, meta: M, root: RootResult<M>): M;
}
```

| Member | Semantics |
|---|---|
| `id` | Unique within the source. It is what `load(id)`, `snapshot.slots[id]` and `zoneSlots` refer to. A slot never names a zone: zone ids belong to the host. |
| `mode` | `'eager'` slots run right after the root, all at once; `'lazy'` slots wait for `loader.load(id)` (the Ensembl protein-domain fan-out is lazy because it costs one request per leaf). |
| `enabled` | Called once per `start()`, after the root, with the context and the root; `false` skips the slot for this generation (it stays `'idle'`). A throwing `enabled` is that slot's error; the other slots still run. Lazy slots ignore it. |
| `run` | Receives `SlotContext`: `ctx`, the retry-wrapped `fetch`, the generation's `signal`, the `tree`, the full `root`, an `onProgress` callback for fan-outs, and `concurrency` when the host set `LoaderOptions.concurrency`. Resolve with the slot's value; reject or throw to put the slot in `'error'` with the message. Nothing else is affected by a failing slot. |
| `toHostData` | Turns the value into the `HostData` fields it provides. Return a top-level field (`{ neighborhood: v }`) when the viewer's built-in zones consume it, or `{ hostData: { myKey: v } }` for a host-defined zone. Called after the hooks below, with the (possibly patched) root. |
| `itemErrorsOf` | For slots that fan out per leaf: return the per-item failures (`FanOutResult.errors`, keyed by gene id). A non-empty map leaves the slot `'ready'` with `SlotState.itemErrors` set, so the viewer can show "N failed" next to a zone that still has data for the rest. |
| `failWhen` | Decides when a *resolved* value is nevertheless a failure — typically "every request failed". A returned string makes the slot `'error'` with that message; the value is kept on `SlotState.value` for inspection. Return `null` to keep `'ready'`. |
| `patchMeta` | Lets a slot update `root.meta`: the BrAPI `variants` slot merges REF/ALT sites into `meta.matrix`. Return a **new** object when anything changed — the loader compares by reference and replaces `snapshot.root` only then — and the same object when nothing did. |

The three hooks are host code too: an exception in any of them is recorded as that slot's error, never as a rejection of `start()` / `load()` and never as a slot stuck in `'loading'`.

`defineSlot(slot)` is an identity function that pins `T`, `Ctx` and `M` so `run`, `toHostData`, `failWhen` and `patchMeta` are type-checked against each other without writing the generics twice.

### `Loader<Ctx, M>` and `LoaderSnapshot<M>`

```ts
interface Loader<Ctx, M> {
  readonly source: TreeDataSource<Ctx, M>;
  getSnapshot(): LoaderSnapshot<M>;          // same reference until something changes
  subscribe(listener: () => void): () => void;
  start(ctx: Ctx): Promise<LoaderSnapshot<M>>;
  load(slotId: string): Promise<void>;
  abort(): void;
  dispose(): void;
}

interface LoaderSnapshot<M> {
  status: SlotStatus;                 // the root load: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null;
  tree: Tree | null;
  root: RootResult<M> | null;         // replaced when a slot's patchMeta returns a new meta
  data: HostDataPatch;                // root.data + toHostData() of every ready slot, in slot order
  slots: Record<string, SlotState>;   // one entry per declared slot, 'idle' until it runs
  zoneStatus: ZoneStatusMap;          // zoneStatusOf(slots, options.zoneSlots)
  pivot: PivotState | null;           // computePivotState(tree, root.nodeOfInterest)
  generation: number;                 // bumps on every start()
}

interface SlotState<T = unknown> {
  status: SlotStatus;
  value: T | undefined;
  error: string | null;
  progress: FanOutProgress | null;    // { done, total, failed } while a fan-out runs
  itemErrors: Record<string, string> | null;
}
```

`createLoader(source, options)` takes:

| Option | Effect |
|---|---|
| `fetch` | Transport; default the global `fetch`, resolved lazily. Sources and slots receive `withRetry(fetch, retry)`. |
| `retry` | `RetryOptions` for the wrapper (attempts, backoff, which statuses retry; `Retry-After` is honoured). |
| `concurrency` | Forwarded to every `SlotContext` for slots that fan out. |
| `zoneSlots` | Host zone id → slot ids feeding it; see below. |
| `warnOnOverwrite` | Dev aid: `console.warn` once per (slot, key) when a later patch overwrites a defined host-data key. |

## Rules

These are the behaviours a source author can rely on; each is covered by `src/sources/loader.test.ts`.

**Generations and abort.** Every `start(ctx)` bumps `generation`, aborts the previous generation's `AbortSignal`, marks any slot still `'loading'` as `'error'` / `'aborted'` (and the root likewise if it was still loading), then resets the snapshot: `status 'loading'`, no tree, all slots `'idle'`, `data {}`. Results that settle for an older generation are dropped, so a source that ignores its `signal` cannot write stale data into a newer snapshot. `start()` and `load()` resolve promptly on abort even when the underlying promise never settles. `abort()` does the same without starting a new generation; `dispose()` first drops every listener, then aborts, so nothing is notified after disposal. `load(id)` before the root has loaded, or with an unknown id, throws; `load(id)` while that slot is already loading is a no-op.

**Isolation.** A throwing `run`, `enabled`, `itemErrorsOf`, `failWhen`, `patchMeta` or `toHostData` affects only its own slot. The root's failure is the only thing that fails the whole load.

**Merging.** `snapshot.data` is recomputed as `root.data` overlaid by `toHostData()` of every ready slot **in slot declaration order**, whatever order the slots settled in, so the result is deterministic. `mergeHostData` is later-wins per top-level key, except that the opaque `hostData` channel is merged one level deep: two slots can each own a `hostData.<key>` without clobbering each other. Keys whose value is `undefined` are ignored.

**Status.** A slot is `'idle'` until it runs; `'loading'` while `run` is pending (with `progress` updates when the slot reports them); then `'ready'` (possibly with `itemErrors`) or `'error'`. `zoneStatus` is recomputed from `zoneSlots` on every slot transition.

**Reference stability.** The snapshot object, and its `data` and `zoneStatus` members, are replaced only when a field actually changes, so `useSyncExternalStore` and memoised selectors stay quiet while nothing moves.

## `zoneSlots`: from slot status to zone status

The viewer shows a spinner, an error glyph or nothing per zone from its `zoneStatus` prop. Slots do not know which zone shows them, so the host declares the mapping:

```ts
const loader = createLoader(source, {
  zoneSlots: {
    neighborhood: ['neighborhood'],    // zone id → slot ids
    genome: ['geneStructures'],
    expression: ['exprAttrs'],
  },
});
```

`zoneStatusOf(slots, zoneSlots)` gives a zone `'loading'` when any mapped slot is loading, else `'error'` when any mapped slot errored, else `'ready'` when the mapped slots that have started are all ready. Idle slots (lazy and not yet requested, or disabled) and unknown slot ids do not participate, so a zone whose slots have not started is absent from the map — the viewer treats absent as nothing to report. `hostPropsFrom(snapshot)` returns `null` until the tree is there, then `{ tree, taxonomy?, nodeOfInterest?, zoneStatus, ...data }` with only defined keys, ready to spread onto `<TBrowse>`.

## Composing sources

`extendSource(source, { id?, slots?, without? })` derives a source with the same `loadRoot`: the original slots minus `without`, each given slot either **replacing** the existing slot of the same id in place (keeping declaration order, and therefore merge order) or appended. Its third type parameter, `Ctx2 extends Ctx`, lets the added slots read context fields the original source never sees — the `expression` flag below is one.

`staticSource(rootOf, slots?)` wraps a `ctx → RootResult` function (sync or async) as a source with id `'static'`: in-memory trees, fixtures, tests, the playground's sample tree with `ctx = { size }`.

## Worked example: the `exprAttrs` slot in gramene-search

gramene-search's Homology panel shows a Gramene gene tree with the viewer's built-in zones plus, on sorghum sites, an expression-attributes zone whose data (`expr_*__attr_*` fields per gene) comes from one tree-scoped Solr query. Before the loader, the panel kept its own fetch bookkeeping for the tree, the neighbourhood, the gene structures and the expression attributes; on the `tbrowse-core` branch it is one source and one loader. From `src/components/results/details/Homology.js`:

```js
import {
  createLoader, defineSlot, extendSource, fetchGrameneExprAttrDocs, grameneGeneTreeSource, hostPropsFrom,
} from 'tbrowse-core';
import { buildExprData } from './exprAttrsZone';

// One slot: fetch the docs for this tree, shape them for the zone, deliver through hostData.
// root.meta carries the tree id and the Solr field that holds it — gene_tree, or a
// clade tree set such as wheat — so the query is scoped the same way as the tree.
const exprAttrsSlot = defineSlot({
  id: 'exprAttrs',
  enabled: (ctx) => ctx.expression === true,
  run: async ({ ctx, fetch, signal, tree, root }) =>
    buildExprData(
      await fetchGrameneExprAttrDocs(ctx.base, root.meta.treeId, { treeField: root.meta.treeField, fetch, signal }),
      tree,
    ),
  toHostData: (v) => ({ hostData: { exprAttrs: v } }),
});

// The built-in Gramene source plus that slot. Its root and its neighborhood /
// geneStructures slots are unchanged.
const homologySource = extendSource(grameneGeneTreeSource, {
  id: 'gramene-homology',
  slots: [exprAttrsSlot],
});

// Host zone id → the slot(s) feeding it, for the per-zone spinner / error glyph.
const ZONE_SLOTS = {
  neighborhood: ['neighborhood'],
  genome: ['geneStructures'],
  expression: ['exprAttrs'],
};
```

Points worth copying:

- **The slot reads context the base source does not know.** `expression` is a gramene-search flag (set from the site configuration); `extendSource`'s `Ctx2 extends Ctx` makes `ctx.expression` legal in the slot while `grameneGeneTreeSource` keeps its own `GrameneCtx`.
- **`run` uses the injected `fetch` and `signal`,** so the query is retried with backoff like every other request and is cancelled when the panel moves to another gene.
- **The value is shaped once, in the slot.** `buildExprData(docs, tree)` joins the per-gene documents to leaf node ids with `joinByLeaf` and `geneIdByLeafNodeId` (see [zones.md](./zones.md)), so the zone body indexes `byNode[row.nodeId]` with no per-render work.
- **Delivery through `hostData.exprAttrs`.** The viewer passes `hostData` through untouched; the zone's `isAvailable` checks `data.hostData.exprAttrs.organs.length`, and because `hostData` merges one level deep the slot cannot collide with another host zone's key.

The panel is a class component, so the loader lives on the instance:

```js
constructor(props) {
  super(props);
  this.loader = createLoader(homologySource, { zoneSlots: ZONE_SLOTS });
  this.state = { snap: this.loader.getSnapshot() };
}
componentDidMount() {
  this._unsubscribe = this.loader.subscribe(() => this.setState({ snap: this.loader.getSnapshot() }));
  this.maybeStartLoader();
}
componentDidUpdate() { this.maybeStartLoader(); }
componentWillUnmount() {
  if (this._unsubscribe) this._unsubscribe();
  this.loader.dispose();
}
maybeStartLoader() {
  // … gates: the tbrowse viewer is selected, the gene doc and its genetree doc are in the store …
  if (this._loaderStartedFor === treeId) return;
  this._loaderStartedFor = treeId;
  void this.loader.start({
    base: this.props.grameneAPI,
    treeId,
    geneId: gene._id,
    rawGenetree: raw,                        // the stored /genetrees doc: the root makes no request
    geneStructures: this.isGenomeZoneEnabled(),
    geneStructureChunkSize: 50,
    geneStructureFl: null,
    expression: this.isExpressionZoneEnabled(),
  });
}
renderTBrowse() {
  const hostProps = hostPropsFrom(this.state.snap);   // null until the tree is adapted
  if (!hostProps) return <div style={{ height }} />;
  return <TBrowse {...hostProps} zones={this.getTbrowseZones()} … />;
}
```

`rawGenetree` together with `treeId` is the zero-request root path of `grameneGeneTreeSource`: the host already holds the document, so the only network traffic is the slots. Switching genes within the same tree does not restart the loader (the dedupe on `_loaderStartedFor`); switching trees does, and the generation rule discards anything the old tree's slots still return. In a function component the same wiring is `useLoader(homologySource, ctx, { zoneSlots: ZONE_SLOTS })` from `tbrowse`.

## A source from scratch

A source over your own API needs a root and, optionally, slots. The shape below is the whole of it:

```ts
import { defineSlot, createLoader, type TreeDataSource } from 'tbrowse-core/sources';
import { getJson, buildUrl, fanOut } from 'tbrowse-core/fetch';
import { parseNewick } from 'tbrowse-core/parsers';
import { leafGeneIds } from 'tbrowse-core/tree';

interface Ctx { base: string; familyId: string; withScores?: boolean }
interface Meta { familyId: string }

const scores = defineSlot<Record<string, number>, Ctx, Meta>({
  id: 'scores',
  mode: 'lazy',
  async run({ ctx, fetch, signal, tree, onProgress, concurrency }) {
    const r = await fanOut(
      leafGeneIds(tree),
      (geneId, s) => getJson<number>(buildUrl(ctx.base, `/score/${geneId}`), { fetch, signal: s }),
      { signal, onProgress, ...(concurrency !== undefined ? { concurrency } : {}) },
    );
    return r.results;                     // per-gene failures are in r.errors; see itemErrorsOf below
  },
  toHostData: (v) => ({ hostData: { scores: v } }),
});

export const familySource: TreeDataSource<Ctx, Meta> = {
  id: 'my-family',
  async loadRoot({ ctx, fetch, signal }) {
    const doc = await getJson<{ newick: string; names: Record<string, string> }>(
      buildUrl(ctx.base, `/family/${ctx.familyId}`), { fetch, signal },
    );
    const { tree } = parseNewick(doc.newick, { labelsAsIds: false });   // synthetic ids, labels on geneId
    return {
      tree,
      data: { geneMetadata: Object.fromEntries(Object.entries(doc.names).map(([g, n]) => [g, { name: n }])) },
      meta: { familyId: ctx.familyId },
    };
  },
  slots: [scores],
};

const loader = createLoader(familySource, { zoneSlots: { scores: ['scores'] } });
await loader.start({ base: 'https://api.example.org', familyId: 'F123' });
await loader.load('scores');
```

To keep the fan-out's partial failures visible, return the whole `FanOutResult` from `run` and add `itemErrorsOf: (v) => v.errors` and `failWhen: (v) => v.progress.total > 0 && v.progress.failed === v.progress.total ? 'All requests failed' : null` — the pattern `fetchGrameneGeneStructures` and the Ensembl `proteinDomains` slot use.

## Checklist

- Parse into synthetic node ids (`parseNewick(…, { labelsAsIds: false })`, the adapters already do) so a numeric label never changes child order; keep the label on `geneId`.
- Use the `fetch` and `signal` you are given; never a module-level `fetch`.
- Put data the root response already contains in `RootResult.data`; make a slot only for a separate request.
- Return `FanOutResult` from fan-out slots and wire `itemErrorsOf` / `failWhen`.
- `patchMeta` returns a new object only when something changed.
- Declare `zoneSlots` in the host, never a zone id in a slot.
- In React, `useLoader` / `useInitialViewState` from `tbrowse`; in a class, subscribe in `componentDidMount` and `dispose()` on unmount.
