# tbrowse-core

The headless half of [tbrowse](https://tbrowse.org): the data model, tree algorithms, file parsers, REST adapters, data-source loaders, UPGMA clustering, fetch helpers and view-state logic that prepare data for the `<TBrowse>` React viewer — usable without the viewer, in a browser or in Node.

```sh
npm install tbrowse-core
```

Zero runtime dependencies. ESM and CommonJS builds with type declarations; Node ≥ 18 or any browser with `fetch`. Version 1.0.0 freezes the public surface described here: additions arrive in minors, removals only in 2.0.

```ts
import { parseNewick } from 'tbrowse-core/parsers';
import { leafOrder, toNewick, pruneToLeaves } from 'tbrowse-core/tree';

const { tree } = parseNewick('((A:0.1,B:0.2):0.05,C:0.3);');
leafOrder(tree);                                        // ['A', 'B', 'C']
toNewick(pruneToLeaves(tree, new Set(['A', 'C']))!);    // '(A:0.150000,C:0.300000);'
```

Guides: [Writing a data source](./docs/data-sources.md) · [Writing a zone with the row helpers](./docs/zones.md) · [API reference](./docs/api/tbrowse-core.md) (generated from the type declarations).

## The model

Everything the viewer draws, and everything the helpers below compute, is described by one flat `Tree` plus companions joined to it by key. Nothing in the model knows about React or the DOM.

```text
  Tree                                        Companions, joined to the tree by key
  ────                                        ────────────────────────────────────
  rootId                                      taxonomyId ─▶ Taxonomy[String(taxonomyId)]
  nodes[id] = {                                              { scientificName, commonName, rank, parentId }
    id, parentId, distance, isLeaf,
    taxonomyId?, geneId?,                     geneId ──────▶ per-leaf maps, Record<GeneId, …>
    eventType?, bootstrap?                                   msa.sequences       geneMetadata
  }                                                          proteinDomains      exonJunctions
                                                             neighborhood        geneStructures
  child order = key order of `nodes`                         genomeFeatures      germplasm
  (parsers and UPGMA use synthetic ids,                      GenotypeMatrix.callsByGeneId
   so a numeric label never reorders
   children)                                  nodeId ──────▶ hostData.<key>  opaque, keyed by the host
                                                             (joinByLeaf / joinByTaxon re-key per-gene
        │                                                     or per-taxon data by node id)
        │ + ViewState
        │   collapsedNodeIds, prunedNodeIds,                                    │
        │   swappedNodeIds, rowHeight                                           │
        ▼                                                                       │
  computeVisibleRows ─▶ VisibleRow[] { nodeId, kind, y, height, leafCount }     │
        │               one row per visible leaf or collapsed clade             │
        ▼                                                                       ▼
  ┌─ zones (tbrowse built-ins or host-defined) ─────────────────────────────────────────┐
  │ per row: n = tree.nodes[row.nodeId]                                                 │
  │   n.geneId      → per-leaf maps      labels, MSA, domains, gene structure, genotype │
  │   n.taxonomyId  → Taxonomy           species names                                  │
  │   row.nodeId    → hostData.<key>     counts, bins, expression (host-defined zones)  │
  │ collapsed rows show a roll-up of their leaves: sumLeafCounts / maxByNode / rollUp   │
  └─────────────────────────────────────────────────────────────────────────────────────┘
```

- **`Tree`** is `{ rootId, nodes: Record<NodeId, TreeNode> }`. Child order is the enumeration order of `nodes` — insertion order, except that canonical-integer keys always come first in numeric order (a JavaScript object invariant). The parsers, the adapters and the UPGMA builder therefore use synthetic node ids (`n0`, `l3`, `c7`) and keep the biological label in `geneId`; pass an explicit `childrenIndex` to the walks and to `toNewick` when a tree with numeric ids must keep insertion order.
- **`Taxonomy`** is keyed by `String(taxonomyId)`. `TaxonomyId` is `string | number`: Gramene gene trees carry numeric NCBI ids, gramene-search's species tree string ids, and both index the same entry.
- **Per-leaf maps** are keyed by the leaf's `geneId` — `MSA.sequences`, `geneMetadata`, `proteinDomains`, `exonJunctions`, `neighborhood`, `geneStructures`, `genomeFeatures`, `germplasm`, and `GenotypeMatrix.callsByGeneId`. `HostData` is the bag of all of them plus the tree; `HostDataPatch` is the same bag without the tree, which is what a data source delivers.
- **`hostData`** is an opaque channel for host-defined zones; `joinByLeaf` and `joinByTaxon` re-key per-gene and per-taxon data by node id so a zone can index it with `row.nodeId`.
- **`ViewState`** (selection, collapsed / pruned / swapped / compressed node ids, node of interest, zone widths and visibility, per-zone state, search) is the one serialisable object a view is made of. `computeVisibleRows` turns tree + view state into the rows every zone paints.

## Entry points

The root exports everything; the subpaths let a bundler drop what a host does not import. The runtime exports of each entry are listed in full (types are on the linked reference page); `node scripts/gen-api-docs.mjs --check` fails when this table and the built declarations disagree.

| Import | Runtime exports |
|---|---|
| `tbrowse-core` | Every name below, plus the root-only names: the data-model types (`Tree`, `TreeNode`, `Taxonomy`, `MSA`, `HostData`, `HostDataPatch`, `ViewState`, `VisibleRow`, `ZoneSpec`, `ZoneStatusMap`, … 47 types), the table-zone helpers `AGGREGATE_METHODS`, `DEFAULT_METHOD_ID`, `NULL_GLYPH`, `defaultAggregators`, `methodForKind`, `normalizeAggregateResult`, the genotype call encoding `decodeCall`, `averageDosage`, `colorForCall`, `colorForAverageDosage`, `DEFAULT_SEP_PHASED`, `DEFAULT_SEP_UNPHASED`, `DEFAULT_UNKNOWN`, and `SEARCH_MATCH_LIMIT`. [Reference](./docs/api/tbrowse-core.md) |
| `tbrowse-core/tree` | Index and lookups: `buildChildrenIndex`, `subtreeIdsOf`, `ancestorIdsOf`, `countLeavesInSubtree`, `leafIdsOf`, `leafGeneIds`, `pathToRoot`, `lca`, `depthOf`, `nodeHeights`, `isLeafNode`, `EMPTY_NODE_ID_SET`. Walks: `preorder`, `postorder`, `leafOrder`. Roll-ups: `rollUp`, `sumLeafCounts`, `maximalExcludedClades`, `leavesFailing`. Editing: `pruneToLeaves`, `subtree`, `computePivotState`, `swapsForLeafOrder`. Serialisation and conversion: `toNewick`, `quoteNewickLabel`, `fromHierarchy`, `fromTreeModel`. Validation: `validateTree`, `assertValidTree`. [Reference](./docs/api/tree.md) |
| `tbrowse-core/parsers` | `parseTreeFile`, `parseTreeSource`, `detectTreeFormat`, `parseNewick`, `parseNewickAll`, `parseNexus`, `parsePhyloXML` (XML parser injected), `parseTableFile`, `detectDelimiter`, `parseDelimitedLine`, `inferColumnKind`. [Reference](./docs/api/parsers.md) |
| `tbrowse-core/fetch` | `fetchWithRetry`, `withRetry`, `defaultFetch`, `backoffMs`, `RETRYABLE_STATUS`, `getJson`, `HttpError`, `buildUrl`, `splitUrl`, `fanOut`, `fanOutChunks`, `chunk`, `mergeRecords`. [Reference](./docs/api/fetch.md) |
| `tbrowse-core/sources` | The contract: `createLoader`, `defineSlot`, `extendSource`, `staticSource`, `hostPropsFrom`, `mergeHostData`, `zoneStatusOf`. Built-in sources: `ensemblGeneTreeSource`, `grameneGeneTreeSource`, `brapiAlleleMatrixSource`, `fileTreeSource`. Adapters: `fromEnsemblGeneTree`, `fromEnsemblProteinFeatures`, `fromEnsemblGeneStructure`, `fromEnsemblGenomeFeatures`, `fromGrameneGenetree`, `fromGrameneGene`, `fromGrameneNeighborhood`, `fromGrameneGeneStructures`, `expandCigar`, `fromBrAPIAlleleMatrix`, `fromBrAPIGermplasm`, `fromBrAPIVariants`, `mergeVariantSites`, `fromBrAPITree`. Ensembl: `ENSEMBL_MIRRORS`, `ENSEMBL_DEFAULT_MIRROR`, `ENSEMBL_DEFAULT_DOMAIN_SOURCES`, `mirrorFor`, `ensemblGeneTreeUrl`, `fetchEnsemblGeneTree`, `fetchEnsemblProteinDomains`, `fetchEnsemblOverlap`. Gramene: `GRAMENE_DEFAULT_BASE`, `GRAMENE_GENE_STRUCTURE_FL`, `GRAMENE_DEFAULT_TREE_FIELD`, `grameneGeneTreeRef`, `grameneNeighborhoodQuery`, `fetchGrameneGene`, `fetchGrameneGenetree`, `fetchGrameneNeighborhood`, `fetchGrameneGeneStructures`, `fetchGrameneSearchDocs`, `fetchGrameneExprAttrDocs`, `facetPairsToCounts`. BrAPI: `brapiPages`, `brapiBaseOf`, `brapiVariantsUrlFrom`, `fetchBrapiAlleleMatrix`, `fetchBrapiGermplasm`, `fetchBrapiVariants`, `fetchBrapiVariantSetTree`. [Reference](./docs/api/sources.md) |
| `tbrowse-core/cluster` | `upgma`, `upgmaFromCalls`, `distanceMatrix`, `dosagesFromCalls`, `dosagesFromGenotypeMatrix`, `DOSAGE_L1_MEAN`. [Reference](./docs/api/cluster.md) |
| `tbrowse-core/view` | `EMPTY_VIEW_STATE`, `buildInitialViewState`, `applyPivot`, `softResetForNewTree`, `ensureZones`, `normalizeViewState`, `pixelWidthsToFr`, `encodeHashState`, `decodeHashState`, `readHashState`, `writeHashState`, `isViewStateLike`, `createDerivedPruneLayer`, `mergeDerivedPrunes`, `stripDerivedPrunes`, `stripPrunesForSnapshot`, `computeVisibleRows`, `computeRowRange`, `LEAF_ROW_HEIGHT`, `SUMMARY_ROW_HEIGHT`. [Reference](./docs/api/view.md) |
| `tbrowse-core/zone` | `rowFlags`, `rowsTotalHeight`, `rowsInRange`, `leafNodeIdByGeneId`, `geneIdByLeafNodeId`, `joinByLeaf`, `joinByTaxon`, `countsFromFacet`, `sumByNode`, `maxByNode`. [Reference](./docs/api/zone.md) |

## Headless in Node: a Gramene gene tree to Newick

The same loader the viewer runs behind `useLoader` works in a script. This one ([`examples/gramene-newick.mjs`](./examples/gramene-newick.mjs)) resolves a sorghum gene to its Gramene gene tree, prunes the tree to four grasses and prints Newick:

```js
import { createLoader, grameneGeneTreeSource } from 'tbrowse-core/sources';
import { leafOrder, pruneToLeaves, toNewick } from 'tbrowse-core/tree';

const KEEP = new Set(['Sorghum bicolor', 'Zea mays', 'Oryza sativa Japonica Group', 'Brachypodium distachyon']);

const loader = createLoader(grameneGeneTreeSource);
const snap = await loader.start({ geneId: 'SORBI_3006G095600', neighborhood: false, geneStructures: false });
if (snap.status !== 'ready') throw new Error(snap.error);

const { tree, taxonomy, meta } = snap.root;
const species = (id) => taxonomy[String(tree.nodes[id].taxonomyId)]?.scientificName ?? '?';
const pruned = pruneToLeaves(tree, (leaf) => KEEP.has(species(leaf.id)));

console.log(`${meta.treeId}: ${leafOrder(tree).length} genes in ${new Set(leafOrder(tree).map(species)).size} species`);
console.log(`kept ${leafOrder(pruned).length}: ${leafOrder(pruned).map((id) => `${tree.nodes[id].geneId} (${species(id)})`).join(', ')}`);
console.log(toNewick(pruned, { precision: 4 }));
```

Run against `https://data.gramene.org/v69` (two requests: `/genes?idList=SORBI_3006G095600` to find the tree id, `/genetrees?idList=…` for the tree; the source's two eager slots are switched off), it printed:

```text
EPlGT00940000164729: 452 genes in 112 species
kept 10: Os05g0355800 (Oryza sativa Japonica Group), SORBI_3006G095600 (Sorghum bicolor), Zm00001eb423430 (Zea mays), Zm00001eb081610 (Zea mays), Os04g0447100 (Oryza sativa Japonica Group), BRADI_5g11590v3 (Brachypodium distachyon), Os03g0179900 (Oryza sativa Japonica Group), BRADI_1g72690v3 (Brachypodium distachyon), Zm00001eb005920 (Zea mays), SORBI_3001G483400 (Sorghum bicolor)
(Os05g0355800:1.7966,(((SORBI_3006G095600:0.0205,(Zm00001eb423430:0.0350,Zm00001eb081610:0.0211):0.0029):0.0447,(Os04g0447100:0.0565,BRADI_5g11590v3:0.0612):0.0081):0.3450,(Os03g0179900:0.0637,(BRADI_1g72690v3:0.0773,(Zm00001eb005920:0.0401,SORBI_3001G483400:0.0129):0.0770):0.0143):0.2637):0.0819);
```

`pruneToLeaves` splices out internal nodes left with one child and adds their branch lengths together, so root-to-leaf distances in the pruned tree equal those in the full one. The snapshot also carries the MSA, gene metadata, protein domains and exon junctions the genetree response contained (`snap.data`), and `snap.pivot` is the collapse/swap set that puts the gene of interest at the top of the viewer.

## Data sources

A `TreeDataSource` loads a root (the tree and whatever came with it) and declares *slots*: independently fetched per-leaf data that becomes `HostData` fields. A `Loader` runs it and exposes a snapshot — tree, merged host data, per-slot status and progress, and a per-zone status map derived from the `zoneSlots` you give it. Zone ids are the host's business, so a slot never names one.

```ts
import { createLoader, ensemblGeneTreeSource, hostPropsFrom } from 'tbrowse-core/sources';

const loader = createLoader(ensemblGeneTreeSource, {
  zoneSlots: { msa: ['proteinDomains'], genome: ['overlap'] },
});
const snap = await loader.start({ geneId: 'ENSG00000139618' });   // root + eager slots
await loader.load('proteinDomains');                                // a lazy slot, on demand
const props = hostPropsFrom(loader.getSnapshot());                 // { tree, taxonomy, msa, proteinDomains, zoneStatus, … }
```

Extend a built-in source with your own slot (gramene-search's expression-attribute zone does this):

```ts
const exprAttrs = defineSlot({
  id: 'exprAttrs',
  enabled: (ctx) => ctx.expression === true,
  run: async ({ ctx, fetch, signal, tree }) => buildExprData(await fetchGrameneExprAttrDocs(ctx.base, ctx.treeId, { fetch, signal }), tree),
  toHostData: (v) => ({ hostData: { exprAttrs: v } }),
});
const source = extendSource(grameneGeneTreeSource, { id: 'gramene-homology', slots: [exprAttrs] });
```

Built-in sources: `ensemblGeneTreeSource` (gene tree with lazy `proteinDomains` and `overlap` slots), `grameneGeneTreeSource` (gene → tree, or a host-supplied `rawGenetree`; `neighborhood` and `geneStructures` slots), `brapiAlleleMatrixSource` (BrAPI v2 allele matrix with the server's tree or a local UPGMA; `germplasm` and `variants` slots), `fileTreeSource` (Newick / Nexus / PhyloXML text or `File`). The contract, the slot hooks (`itemErrorsOf`, `failWhen`, `patchMeta`), the generation and abort rules and a full worked example are in [docs/data-sources.md](./docs/data-sources.md).

## Zones

A host-defined zone is a pair of React components the viewer renders beside the tree; the arithmetic they share is here. `rowsInRange` picks the rows in the virtualised window, `rowFlags` turns the viewer's hover and selection state into per-row flags, `rowsTotalHeight` sizes the scroll body, and `joinByLeaf` / `joinByTaxon` / `countsFromFacet` re-key host data by node id so a row can look it up directly. See [docs/zones.md](./docs/zones.md), which walks through gramene-search's counts zone.

## View state

`buildInitialViewState(zones, options)` produces the viewer's initial `ViewState` from a zone list (fr widths, visibility, exclusive groups, optional pivot), `applyPivot` puts a gene at the top, `normalizeViewState` repairs a persisted blob, `encodeHashState` / `decodeHashState` share one in a URL, and `createDerivedPruneLayer` keeps filter-derived prunes out of what a host persists. `computeVisibleRows` / `computeRowRange` are the row model the viewer and every zone agree on.

```ts
import { fetchEnsemblGeneTree } from 'tbrowse-core/sources';
import { buildInitialViewState, applyPivot } from 'tbrowse-core/view';
import { computePivotState } from 'tbrowse-core/tree';

const { tree, taxonomy, msa, geneMetadata } = await fetchEnsemblGeneTree('ENSG00000139618');
const viewState = applyPivot(buildInitialViewState(zones), computePivotState(tree, 'ENSG00000139618'));
```

## Relationship to tbrowse

`tbrowse` (the React viewer) depends on `tbrowse-core` (`>=0.1.0 <2.0.0`) and re-exports every type, so `import type { Tree } from 'tbrowse'` and `import type { Tree } from 'tbrowse-core'` name the same type. The viewer's `ZoneDefinition` extends the core's `ZoneSpec`, so a zone list can be handed to `buildInitialViewState` directly; `useLoader` and `useInitialViewState` in `tbrowse` wrap `createLoader` and `buildInitialViewState` for React.

Compatibility notes:

- `TaxonomyId` widened from `number` to `string | number` in tbrowse-core 0.1.0 / tbrowse 2.11.0, and `Taxonomy` is keyed by `string`. A TypeScript host passing `node.taxonomyId` to a `number` parameter needs a cast; lookups and equality tests compile unchanged.
- The functions tbrowse 2.10 exported that now live here (`fromEnsembl*`, `fromGramene*`, `computePivotState`, `computeVisibleRows`, `computeRowRange`, `LEAF_ROW_HEIGHT`, `SUMMARY_ROW_HEIGHT`) are still re-exported from `tbrowse` with `@deprecated`; import them from `tbrowse-core`. Those function re-exports are removed in tbrowse 3.0; the type re-exports stay.
- The names the viewer imports from the core are listed in `scripts/surface-used-by-tbrowse.txt` and checked on every build, so a 1.x core always satisfies an installed 2.x viewer.

## Documentation

| Where | What |
|---|---|
| [docs/data-sources.md](./docs/data-sources.md) | Writing a data source: the `TreeDataSource` / `DataSlot` / `Loader` contract, `zoneSlots`, `patchMeta`, `failWhen`, `itemErrorsOf`, `extendSource` / `staticSource`, generation and abort rules, with gramene-search's `exprAttrs` slot as the worked example. |
| [docs/zones.md](./docs/zones.md) | Writing a zone with the row helpers, with gramene-search's counts zone as the worked example. |
| [docs/api/](./docs/api/tbrowse-core.md) | API reference, one page per entry point, generated from the built declarations (`npm run docs:api`; `node scripts/gen-api-docs.mjs --check` verifies it and the table above). |
| [CHANGELOG.md](./CHANGELOG.md) | Release notes. |

## License

MIT.
