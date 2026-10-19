import { describe, expect, it } from 'vitest';
import { quoteNewickLabel, toNewick } from './newick';
import type { Tree } from '../types';

//   r
//   ├── i (d=0.5)
//   │   ├── A (d=1)
//   │   └── B (d=2.5)
//   └── C (d=3)
const tree: Tree = {
  rootId: 'r',
  nodes: {
    r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
    i: { id: 'i', parentId: 'r', distance: 0.5, isLeaf: false },
    A: { id: 'A', parentId: 'i', distance: 1, isLeaf: true, geneId: 'A' },
    B: { id: 'B', parentId: 'i', distance: 2.5, isLeaf: true, geneId: 'gene B' },
    C: { id: 'C', parentId: 'r', distance: 3, isLeaf: true },
  },
};

describe('quoteNewickLabel', () => {
  it('leaves plain labels alone', () => {
    expect(quoteNewickLabel('ABC_1')).toBe('ABC_1');
    expect(quoteNewickLabel('a-b.c|d')).toBe('a-b.c|d');
  });

  it("quotes whitespace and punctuation, doubling embedded '", () => {
    expect(quoteNewickLabel('gene B')).toBe("'gene B'");
    expect(quoteNewickLabel('a,b')).toBe("'a,b'");
    expect(quoteNewickLabel('x(1)')).toBe("'x(1)'");
    expect(quoteNewickLabel("it's")).toBe("'it''s'");
    expect(quoteNewickLabel('a[1]')).toBe("'a[1]'");
    expect(quoteNewickLabel('a;b')).toBe("'a;b'");
    expect(quoteNewickLabel('a:b')).toBe("'a:b'");
  });
});

describe('toNewick', () => {
  it('writes children in insertion order, 6-decimal lengths, no root length, no internal labels', () => {
    expect(toNewick(tree)).toBe("((A:1.000000,'gene B':2.500000):0.500000,C:3.000000);");
  });

  it('respects precision and branchLengths: false', () => {
    expect(toNewick(tree, { precision: 2 })).toBe("((A:1.00,'gene B':2.50):0.50,C:3.00);");
    expect(toNewick(tree, { branchLengths: false })).toBe("((A,'gene B'),C);");
  });

  it('uses a custom label function (internal labels included)', () => {
    expect(toNewick(tree, { label: (n) => n.id, branchLengths: false })).toBe('((A,B)i,C)r;');
    expect(toNewick(tree, { label: (n) => (n.isLeaf ? n.id.toLowerCase() : null) })).toBe(
      '((a:1.000000,b:2.500000):0.500000,c:3.000000);',
    );
  });

  it('serialises a subtree and honours swaps', () => {
    expect(toNewick(tree, { rootId: 'i' })).toBe("(A:1.000000,'gene B':2.500000);");
    expect(toNewick(tree, { swappedNodeIds: new Set(['r']) })).toBe(
      "(C:3.000000,(A:1.000000,'gene B':2.500000):0.500000);",
    );
    expect(toNewick(tree, { swappedNodeIds: new Set(['r', 'i']) })).toBe(
      "(C:3.000000,('gene B':2.500000,A:1.000000):0.500000);",
    );
  });

  it('a single-leaf tree is just the label', () => {
    const single: Tree = { rootId: 'x', nodes: { x: { id: 'x', parentId: null, distance: 0, isLeaf: true } } };
    expect(toNewick(single)).toBe('x;');
    expect(toNewick(tree, { rootId: 'B' })).toBe("'gene B';");
  });

  it('handles polytomies', () => {
    const poly: Tree = {
      rootId: 'r',
      nodes: {
        r: { id: 'r', parentId: null, distance: 0, isLeaf: false },
        a: { id: 'a', parentId: 'r', distance: 1, isLeaf: true },
        b: { id: 'b', parentId: 'r', distance: 1, isLeaf: true },
        c: { id: 'c', parentId: 'r', distance: 1, isLeaf: true },
      },
    };
    expect(toNewick(poly, { branchLengths: false })).toBe('(a,b,c);');
  });

  it('throws on an unknown root', () => {
    expect(() => toNewick(tree, { rootId: 'ghost' })).toThrow(/not in the tree/);
  });
});
