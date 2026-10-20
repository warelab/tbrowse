#!/usr/bin/env node
// Headless tbrowse-core in Node: fetch a Gramene gene tree through the
// loader, prune it to a few grasses and print the result as Newick.
//
//   npm install tbrowse-core        # or, inside this repo, `npm run build -w packages/core`
//   node examples/gramene-newick.mjs [geneId]
//
// Two requests go to https://data.gramene.org/v69: /genes (gene → tree id)
// and /genetrees (the tree with its MSA). The two eager slots of the source
// (neighborhood, geneStructures) are switched off; nothing here needs them.
import { createLoader, grameneGeneTreeSource } from 'tbrowse-core/sources';
import { leafOrder, pruneToLeaves, toNewick } from 'tbrowse-core/tree';

const geneId = process.argv[2] ?? 'SORBI_3006G095600';
const KEEP = new Set(['Sorghum bicolor', 'Zea mays', 'Oryza sativa Japonica Group', 'Brachypodium distachyon']);

const loader = createLoader(grameneGeneTreeSource);
const snap = await loader.start({ geneId, neighborhood: false, geneStructures: false });
if (snap.status !== 'ready') throw new Error(snap.error ?? 'root load failed');

const { tree, taxonomy, meta } = snap.root;
const species = (id) => taxonomy[String(tree.nodes[id].taxonomyId)]?.scientificName ?? '?';
const pruned = pruneToLeaves(tree, (leaf) => KEEP.has(species(leaf.id)));
if (!pruned) throw new Error('no leaf from the kept species in this tree');

console.log(`${meta.treeId}: ${leafOrder(tree).length} genes in ${new Set(leafOrder(tree).map(species)).size} species`);
console.log(`kept ${leafOrder(pruned).length}: ${leafOrder(pruned).map((id) => `${tree.nodes[id].geneId} (${species(id)})`).join(', ')}`);
console.log(toNewick(pruned, { precision: 4 }));
