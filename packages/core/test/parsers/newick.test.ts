import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseNewick, parseNewickAll } from '../../src/parsers';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/parsers/${name}`, import.meta.url), 'utf8');

describe('parseNewick', () => {
  it('parses the golden fixture: quoted labels, [comments], bootstrap labels, scientific notation', () => {
    const { format, tree, warnings } = parseNewick(fixture('simple.nwk'));
    expect(format).toBe('newick');
    expect(warnings).toEqual([]);
    const leaves = Object.values(tree.nodes).filter((n) => n.isLeaf).map((n) => n.id).sort();
    expect(leaves).toEqual(['A', 'B', 'C', "D 'quoted', name"]);
    // Leaf label → id AND geneId.
    expect(tree.nodes['A']).toMatchObject({ id: 'A', geneId: 'A', distance: 0.1, isLeaf: true });
    expect(tree.nodes["D 'quoted', name"]).toMatchObject({ geneId: "D 'quoted', name", distance: 0.4 });
    // Scientific-notation branch length.
    expect(tree.nodes['C']!.distance).toBe(0.001);
    // Numeric internal labels in 0..100 become bootstrap and stay the id.
    expect(tree.nodes['95']).toMatchObject({ id: '95', bootstrap: 95, distance: 0.3, isLeaf: false });
    expect(tree.nodes['0.87']).toMatchObject({ id: '0.87', bootstrap: 0.87, distance: 0.5 });
    // Root is unlabelled → synthetic id; parent links are consistent.
    expect(tree.rootId).toBe('__node_0');
    expect(tree.nodes[tree.rootId]!.parentId).toBeNull();
    expect(tree.nodes['A']!.parentId).toBe('95');
    expect(tree.nodes['95']!.parentId).toBe('__node_0');
  });

  it('accepts ")95:0.1" bootstrap-as-label and a bare ")95" label', () => {
    const t = parseNewick('((A,B)95:0.1,C);').tree;
    expect(t.nodes['95']).toMatchObject({ bootstrap: 95, distance: 0.1 });
    const u = parseNewick('((A,B)95,C)').tree;
    expect(u.nodes['95']).toMatchObject({ bootstrap: 95, distance: 0 });
    // Out-of-range numeric labels are ids but not bootstrap.
    const v = parseNewick('((A,B)150,C);').tree;
    expect(v.nodes['150']!.bootstrap).toBeUndefined();
  });

  it('handles polytomies', () => {
    const { tree } = parseNewick('(A,B,C,D)root;');
    expect(tree.rootId).toBe('root');
    const kids = Object.values(tree.nodes).filter((n) => n.parentId === 'root');
    expect(kids.map((n) => n.id).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('renames duplicate leaf labels to __2, __3 and warns; unlabelled leaves get synthetic ids', () => {
    const { tree, warnings } = parseNewick('((A,A),(A,));');
    expect(Object.keys(tree.nodes).sort()).toEqual(
      ['A', 'A__2', 'A__3', '__leaf_1', '__node_0', '__node_2', '__node_3'].sort(),
    );
    expect(tree.nodes['A__2']).toMatchObject({ id: 'A__2', geneId: 'A', isLeaf: true });
    expect(tree.nodes['__leaf_1']!.geneId).toBeUndefined();
    expect(warnings).toEqual([
      'duplicate leaf label "A" — renamed to "A__2"',
      'duplicate leaf label "A" — renamed to "A__3"',
    ]);
  });

  it('tolerates a missing trailing semicolon and surrounding whitespace', () => {
    const a = parseNewick('(A:1,B:2)').tree;
    const b = parseNewick('  (A:1,B:2);\n').tree;
    expect(a).toEqual(b);
  });

  it('parses scientific-notation and warns on invalid branch lengths', () => {
    const { tree, warnings } = parseNewick('(A:1E-5,B:2.5e+2,C:abc);');
    expect(tree.nodes['A']!.distance).toBe(0.00001);
    expect(tree.nodes['B']!.distance).toBe(250);
    expect(tree.nodes['C']!.distance).toBe(0);
    expect(warnings).toEqual(['invalid branch length "abc"']);
  });

  it('strips [comments] anywhere, including inside the body', () => {
    const { tree } = parseNewick('[&R] (A[&x=1]:0.1,B:0.2)[end];');
    expect(Object.keys(tree.nodes).sort()).toEqual(['A', 'B', '__node_0']);
    expect(tree.nodes['A']!.distance).toBe(0.1);
  });

  it('throws on empty, whitespace-only or comment-only input', () => {
    expect(() => parseNewick('')).toThrow('Newick: empty input');
    expect(() => parseNewick('  \n ')).toThrow('Newick: empty input');
    expect(() => parseNewick('[just a comment];')).toThrow('Newick: empty input');
  });

  it('throws on unbalanced parentheses and unterminated quotes', () => {
    expect(() => parseNewick('((A,B);')).toThrow(/expected '\)'/);
    expect(() => parseNewick("('A,B);")).toThrow('unterminated quoted name');
  });

  it('warns about trailing content after the root', () => {
    const { warnings } = parseNewick('(A,B)x)junk;');
    expect(warnings[0]).toMatch(/^trailing content at position/);
  });

  it('leafGeneId: false keeps labels as ids only; idPrefix namespaces synthetic ids', () => {
    const { tree } = parseNewick('((A,B),C);', { leafGeneId: false, idPrefix: 't1' });
    expect(tree.nodes['A']!.geneId).toBeUndefined();
    expect(tree.rootId).toBe('t1__node_1');
    expect(tree.nodes['A']!.parentId).toBe('t1__node_0');
  });
});

describe('parseNewickAll', () => {
  it('parses every ;-separated tree in a file', () => {
    const trees = parseNewickAll(fixture('two-trees.nwk'));
    expect(trees).toHaveLength(2);
    expect(Object.keys(trees[0]!.tree.nodes).sort()).toEqual(['A', 'B', '__node_0']);
    expect(trees[1]!.tree.rootId).toBe('Inner');
    expect(trees[1]!.tree.nodes['E']!.distance).toBe(0.5);
    expect(trees.every((t) => t.format === 'newick')).toBe(true);
  });

  it('does not split on semicolons inside quotes or comments, and skips blank statements', () => {
    const trees = parseNewickAll("('a;b',C)[note; one];;\n\n(D,E)");
    expect(trees).toHaveLength(2);
    expect(trees[0]!.tree.nodes['a;b']).toBeDefined();
    expect(Object.keys(trees[1]!.tree.nodes).sort()).toEqual(['D', 'E', '__node_0']);
  });

  it('returns [] for whitespace-only input and forwards opts', () => {
    expect(parseNewickAll('  \n')).toEqual([]);
    const [t] = parseNewickAll('(A,B);', { leafGeneId: false });
    expect(t!.tree.nodes['A']!.geneId).toBeUndefined();
  });
});
