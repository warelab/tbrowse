import { describe, expect, it } from 'vitest';
import { fromHierarchy, fromTreeModel, type TreeModelLike } from './hierarchy';
import { validateTree, leafIdsOf } from './index';
import { taxDistModel } from '../../test/fixtures/tree/taxDistModel';

describe('fromTreeModel', () => {
  it('emits string ids and string taxonomyIds by default, with toTbrowseTree semantics', () => {
    const { tree, taxonomy, leafIds, leafTaxonIds, warnings } = fromTreeModel(taxDistModel);
    expect(warnings).toEqual([]);
    expect(tree.rootId).toBe('33090');
    expect(validateTree(tree)).toEqual([]);
    // Integer-like keys enumerate in numeric order regardless of insertion
    // order (a property of JS objects the legacy adapter shared), so only
    // the key set is asserted here; `leafTaxonIds` below carries the walk order.
    expect(Object.keys(tree.nodes).sort()).toEqual(['33090', '4479', '4558', '4577', '4527', '39947', '39946', '3702'].sort());
    expect(tree.nodes['33090']).toEqual({ id: '33090', parentId: null, distance: 0, isLeaf: false, taxonomyId: '33090' });
    expect(tree.nodes['4558']).toEqual({ id: '4558', parentId: '4479', distance: 1, isLeaf: true, taxonomyId: '4558' });
    expect(tree.nodes['4527']).toEqual({ id: '4527', parentId: '4479', distance: 1, isLeaf: false, taxonomyId: '4527' });
    for (const n of Object.values(tree.nodes)) expect(typeof n.taxonomyId).toBe('string');
    expect(leafTaxonIds).toEqual(['4558', '4577', '39947', '39946', '3702']);
    expect(leafIds).toEqual(leafTaxonIds);
    // Same leaf set as the index helper (whose order follows numeric key enumeration).
    expect([...leafIds].sort()).toEqual([...leafIdsOf(tree)].sort());
    expect(taxonomy['4558']).toEqual({ scientificName: 'Sorghum bicolor', commonName: 'Sorghum bicolor', rank: 'species' });
    expect(taxonomy['39947']).toEqual({ scientificName: 'Oryza sativa Japonica Group', commonName: 'Oryza sativa Japonica Group' });
    expect(Object.keys(taxonomy)).toEqual(Object.keys(tree.nodes));
  });

  it("taxonomyIdAs: 'number' emits numeric taxonomyIds while ids and taxonomy keys stay strings", () => {
    const { tree, taxonomy } = fromTreeModel(taxDistModel, { taxonomyIdAs: 'number' });
    expect(tree.nodes['4558']!.taxonomyId).toBe(4558);
    expect(tree.nodes['4558']!.id).toBe('4558');
    for (const n of Object.values(tree.nodes)) expect(typeof n.taxonomyId).toBe('number');
    expect(taxonomy['4558']!.scientificName).toBe('Sorghum bicolor');
    expect(Object.keys(taxonomy)).toEqual(Object.keys(tree.nodes));
  });

  it('distance option sets every non-root branch', () => {
    const { tree } = fromTreeModel(taxDistModel, { distance: 2.5 });
    expect(tree.nodes['33090']!.distance).toBe(0);
    expect(tree.nodes['4479']!.distance).toBe(2.5);
    expect(tree.nodes['39946']!.distance).toBe(2.5);
  });

  it('skips duplicate ids (and their subtrees) with a warning, like the original guard', () => {
    const dup: TreeModelLike = {
      model: { id: 1, name: 'root' },
      children: [
        { model: { id: 2, name: 'a' } },
        { model: { id: 2, name: 'again' }, children: [{ model: { id: 3, name: 'hidden' } }] },
      ],
    };
    const { tree, taxonomy, warnings, leafTaxonIds } = fromTreeModel(dup);
    expect(Object.keys(tree.nodes)).toEqual(['1', '2']);
    expect(taxonomy['2']!.scientificName).toBe('a');
    expect(leafTaxonIds).toEqual(['2']);
    expect(warnings).toEqual(['duplicate node id "2" skipped']);
  });

  it('a model name of undefined leaves the taxonomy entry without names', () => {
    const { taxonomy } = fromTreeModel({ model: { id: 'x' } });
    expect(taxonomy['x']).toEqual({});
  });

  it('throws when the root has no model', () => {
    expect(() => fromTreeModel({} as TreeModelLike)).toThrow(/no model/);
  });
});

describe('fromHierarchy', () => {
  interface N {
    name: string;
    len?: number;
    gene?: string;
    taxon?: number;
    kids?: N[];
  }
  const root: N = {
    name: 'root',
    kids: [
      { name: 'clade', len: 0.5, kids: [
        { name: 'a', len: 1, gene: 'GENE_A', taxon: 4558 },
        { name: 'b', len: 2, gene: 'GENE_B', taxon: 4577 },
      ] },
      { name: 'c', len: 3, gene: 'GENE_C', taxon: 4558 },
    ],
  };

  it('uses the accessors, defaulting distance to 0/1', () => {
    const { tree, taxonomy, leafIds, warnings } = fromHierarchy(root, {
      id: (n) => n.name,
      children: (n) => n.kids,
      geneId: (n) => n.gene,
      taxonomyId: (n) => n.taxon,
    });
    expect(warnings).toEqual([]);
    expect(taxonomy).toEqual({});
    expect(leafIds).toEqual(['a', 'b', 'c']);
    expect(tree.nodes['root']).toEqual({ id: 'root', parentId: null, distance: 0, isLeaf: false });
    expect(tree.nodes['clade']).toEqual({ id: 'clade', parentId: 'root', distance: 1, isLeaf: false });
    expect(tree.nodes['a']).toEqual({ id: 'a', parentId: 'clade', distance: 1, isLeaf: true, geneId: 'GENE_A', taxonomyId: 4558 });
    expect('taxonomyId' in tree.nodes['root']!).toBe(false);
    expect('geneId' in tree.nodes['root']!).toBe(false);
    expect(validateTree(tree)).toEqual([]);
  });

  it('custom distance receives the parent; taxon entries are keyed by String(taxonomyId)', () => {
    const { tree, taxonomy, warnings } = fromHierarchy(root, {
      id: (n) => n.name,
      children: (n) => n.kids,
      distance: (n, parent) => (parent === null ? 0 : n.len ?? 0),
      taxonomyId: (n) => n.taxon,
      taxon: (n) => (n.taxon !== undefined ? { scientificName: `taxon ${n.taxon}` } : undefined),
    });
    expect(tree.nodes['clade']!.distance).toBe(0.5);
    expect(tree.nodes['b']!.distance).toBe(2);
    expect(taxonomy).toEqual({ '4558': { scientificName: 'taxon 4558' }, '4577': { scientificName: 'taxon 4577' } });
    expect(warnings).toEqual([]);
  });

  it('warns when a taxon entry has no taxonomyId to key it', () => {
    const { taxonomy, warnings } = fromHierarchy(root, {
      id: (n) => n.name,
      children: (n) => n.kids,
      taxon: () => ({ rank: 'x' }),
    });
    expect(taxonomy).toEqual({});
    expect(warnings).toHaveLength(5);
    expect(warnings[0]).toMatch(/no taxonomyId/);
  });
});
