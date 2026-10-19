/**
 * Hand-made `taxonomy-with-genomes` tree in the `tree-model` shape
 * (`node.model`, `node.children`) that gramene-search's `selectGrameneTaxDist`
 * returns, plus a Solr `taxon_id` facet array for it. Numeric ids on purpose:
 * `fromTreeModel` must stringify them by default.
 */
import type { TreeModelLike } from '../../../src/tree/hierarchy';

export const taxDistModel: TreeModelLike = {
  model: { id: 33090, name: 'Viridiplantae', rank: 'kingdom' },
  children: [
    {
      model: { id: 4479, name: 'Poaceae', rank: 'family' },
      children: [
        { model: { id: 4558, name: 'Sorghum bicolor', rank: 'species' } },
        { model: { id: 4577, name: 'Zea mays', rank: 'species' } },
        {
          model: { id: 4527, name: 'Oryza', rank: 'genus' },
          children: [
            { model: { id: 39947, name: 'Oryza sativa Japonica Group' } },
            { model: { id: 39946, name: 'Oryza sativa Indica Group' } },
          ],
        },
      ],
    },
    { model: { id: 3702, name: 'Arabidopsis thaliana', rank: 'species' } },
  ],
};

/** `[id, count, id, count, …]` as Solr emits it; `12345` matches no node. */
export const taxonIdFacet: ReadonlyArray<string | number> = [
  '4558', 12,
  '4577', 7,
  '39947', 0,
  '39946', 5,
  '3702', 3,
  '12345', 9,
];
