import { describe, expect, it } from 'vitest';
import { pruneToLeaves, subtree } from './prune';
import { validateTree, buildChildrenIndex } from './index';
import { geneTree } from '../../test/fixtures/tree/geneTree';

describe('pruneToLeaves', () => {
  it('keeps a set of leaves and splices unary internals, summing distances', () => {
    // Keep g3 and g6: n3 (g3,g4) → only g3 survives, n2 (n3,g5) → only g3
    // survives, so g3 hangs directly off n0 with distance 0.05+0.25+0.1.
    const out = pruneToLeaves(geneTree, new Set(['g3', 'g6']));
    expect(out).not.toBeNull();
    expect(out!.rootId).toBe('n0');
    expect(Object.keys(out!.nodes)).toEqual(['n0', 'g3', 'g6']);
    expect(out!.nodes['g3']).toMatchObject({ ...geneTree.nodes['g3']!, parentId: 'n0', distance: expect.closeTo(0.05 + 0.25 + 0.1, 12) });
    expect(out!.nodes['g6']).toEqual(geneTree.nodes['g6']);
    expect(validateTree(out!)).toEqual([]);
  });

  it('accepts a predicate and keeps multi-child internals intact', () => {
    const out = pruneToLeaves(geneTree, (leaf) => leaf.taxonomyId === 4577 || leaf.taxonomyId === 39947);
    // g2 (maize) under n1 → n1 spliced; n2 keeps n3 (g3,g4) and g5.
    expect(Object.keys(out!.nodes)).toEqual(['n0', 'g2', 'n2', 'n3', 'g3', 'g4', 'g5']);
    expect(out!.nodes['g2']!.parentId).toBe('n0');
    expect(out!.nodes['g2']!.distance).toBeCloseTo(0.35 + 0.2);
    expect(out!.nodes['n2']).toEqual(geneTree.nodes['n2']);
    expect(buildChildrenIndex(out!).get('n2')).toEqual(['n3', 'g5']);
    expect(validateTree(out!)).toEqual([]);
  });

  it('moves the root down when the old root becomes unary', () => {
    const out = pruneToLeaves(geneTree, new Set(['g3', 'g5']));
    expect(out!.rootId).toBe('n2');
    expect(out!.nodes['n2']).toEqual({ ...geneTree.nodes['n2']!, parentId: null });
    expect(Object.keys(out!.nodes)).toEqual(['n2', 'g3', 'g5']);
    expect(out!.nodes['g3']!.parentId).toBe('n2');
    expect(out!.nodes['g3']!.distance).toBeCloseTo(0.05 + 0.25);
    expect(validateTree(out!)).toEqual([]);
  });

  it('a single surviving leaf becomes the whole tree', () => {
    const out = pruneToLeaves(geneTree, new Set(['g4']));
    expect(out!.rootId).toBe('g4');
    expect(Object.keys(out!.nodes)).toEqual(['g4']);
    expect(out!.nodes['g4']!.parentId).toBeNull();
    expect(out!.nodes['g4']!.distance).toBeCloseTo(0.06 + 0.25 + 0.1 + 0);
  });

  it('returns null when nothing is kept', () => {
    expect(pruneToLeaves(geneTree, new Set())).toBeNull();
    expect(pruneToLeaves(geneTree, () => false)).toBeNull();
  });

  it('collapseUnary: false keeps single-child internals and distances', () => {
    const out = pruneToLeaves(geneTree, new Set(['g3', 'g6']), { collapseUnary: false });
    expect(Object.keys(out!.nodes)).toEqual(['n0', 'n2', 'n3', 'g3', 'g6']);
    expect(out!.nodes['g3']).toEqual(geneTree.nodes['g3']);
    expect(out!.nodes['n3']).toEqual(geneTree.nodes['n3']);
    expect(out!.nodes['n2']).toEqual(geneTree.nodes['n2']);
  });

  it('keeping every leaf returns an equal tree', () => {
    expect(pruneToLeaves(geneTree, () => true)).toEqual(geneTree);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(geneTree);
    pruneToLeaves(geneTree, new Set(['g3']));
    expect(JSON.stringify(geneTree)).toBe(before);
  });
});

describe('subtree', () => {
  it('extracts a subtree with a nulled parent and original order', () => {
    const out = subtree(geneTree, 'n2');
    expect(out.rootId).toBe('n2');
    expect(Object.keys(out.nodes)).toEqual(['n2', 'n3', 'g3', 'g4', 'g5']);
    expect(out.nodes['n2']).toEqual({ ...geneTree.nodes['n2']!, parentId: null });
    expect(out.nodes['g5']).toEqual(geneTree.nodes['g5']);
    expect(validateTree(out)).toEqual([]);
    expect(geneTree.nodes['n2']!.parentId).toBe('n0'); // input untouched
  });

  it('a leaf subtree is a single-node tree', () => {
    const out = subtree(geneTree, 'g6');
    expect(out).toEqual({ rootId: 'g6', nodes: { g6: { ...geneTree.nodes['g6']!, parentId: null } } });
  });

  it('throws on an unknown root', () => {
    expect(() => subtree(geneTree, 'ghost')).toThrow(/not in the tree/);
  });
});
