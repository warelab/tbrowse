import { describe, expect, it } from 'vitest';
import { computeTreeLayout, compressSpines, type TreeLayoutNode } from './layout';
import type { Tree, VisibleRow } from '../../types';

// Unbalanced tree: n2 is a leaf one edge from root; n4/n5 are leaves three
// edges deep. A phylogram (equal distances) puts n2 and n4/n5 at different x;
// a cladogram must align all three at the right edge.
//   n0
//   ├── n1 ── n3 ── { n4, n5 }
//   └── n2 (leaf, shallow)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true },
    n3: { id: 'n3', parentId: 'n1', distance: 1, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true },
  },
};

const rows: VisibleRow[] = [
  { kind: 'leaf', nodeId: 'n4', y: 0, height: 24, leafCount: 1 },
  { kind: 'leaf', nodeId: 'n5', y: 24, height: 24, leafCount: 1 },
  { kind: 'leaf', nodeId: 'n2', y: 48, height: 24, leafCount: 1 },
];

const x = (nodes: { nodeId: string; x: number }[], id: string) =>
  nodes.find((n) => n.nodeId === id)!.x;

describe('computeTreeLayout cladogram mode', () => {
  it('aligns every visible end at the right edge regardless of depth', () => {
    const { nodes } = computeTreeLayout({
      tree,
      visibleRows: rows,
      drawingLeftX: 0,
      drawingWidth: 300,
      layoutMode: 'cladogram',
    });
    // All three leaves land at the right edge (x = drawingLeftX + width).
    expect(x(nodes, 'n4')).toBeCloseTo(300, 5);
    expect(x(nodes, 'n5')).toBeCloseTo(300, 5);
    expect(x(nodes, 'n2')).toBeCloseTo(300, 5);
    // Root at the left; internal nodes step inward by topological height
    // (maxHeight = 3 → one step = 100px).
    expect(x(nodes, 'n0')).toBeCloseTo(0, 5);
    expect(x(nodes, 'n1')).toBeCloseTo(100, 5);
    expect(x(nodes, 'n3')).toBeCloseTo(200, 5);
  });

  it('does NOT align the shallow leaf in phylogram mode (default)', () => {
    const { nodes } = computeTreeLayout({
      tree,
      visibleRows: rows,
      drawingLeftX: 0,
      drawingWidth: 300,
    });
    // n4/n5 are deepest → right edge; n2 is shallower → left of them.
    expect(x(nodes, 'n4')).toBeCloseTo(300, 5);
    expect(x(nodes, 'n2')).toBeLessThan(x(nodes, 'n4') - 1);
  });
});

describe('compressSpines', () => {
  // Caterpillar with a pruned-out spine: the root forks into a kept leaf K
  // and an internal node n1; n1→n2→n3 is a single-visible-child ladder (the
  // other children pruned away, hence not present in the layout) leading to a
  // deep leaf L.
  //   n0 ──┬── K (leaf, shallow)
  //        └── n1 ── n2 ── n3 ── L (leaf, deep)
  const node = (
    nodeId: string,
    parentId: string | null,
    xPos: number,
    yPos: number,
    isLeaf: boolean,
  ): TreeLayoutNode => ({
    nodeId,
    parentId,
    x: xPos,
    y: yPos,
    isVisibleEnd: isLeaf,
    isLeaf,
    isCollapsedSummary: false,
  });

  const spineNodes: TreeLayoutNode[] = [
    node('n0', null, 0, 50, false),
    node('K', 'n0', 10, 100, true),
    node('n1', 'n0', 10, 0, false),
    node('n2', 'n1', 20, 0, false),
    node('n3', 'n2', 30, 0, false),
    node('L', 'n3', 100, 0, true),
  ];

  const xOf = (nodes: TreeLayoutNode[], id: string) =>
    nodes.find((n) => n.nodeId === id)!.x;

  it('collapses an interior single-child run to a fixed width', () => {
    const res = compressSpines(spineNodes, 'n0', { compressedWidth: 26 });
    expect(res).not.toBeNull();
    const r = res!;
    // The run n1→L spans 26px from the entry fork (n0 at x=0): the start
    // collapses onto the entry x, the exit lands at entry.x + width.
    expect(xOf(r.nodes, 'n1')).toBeCloseTo(0, 5);
    expect(xOf(r.nodes, 'L')).toBeCloseTo(26, 5);
    // The unrelated kept leaf K keeps its original position.
    expect(xOf(r.nodes, 'K')).toBeCloseTo(10, 5);
    // One segment, the whole run, exiting at the deep leaf.
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].startId).toBe('n1');
    expect(r.segments[0].exitId).toBe('L');
    expect(r.segments[0].passThroughIds).toEqual(['n1', 'n2', 'n3']);
    // Spine-internal branches skipped (the start keeps its entry branch);
    // every pass-through glyph suppressed.
    expect([...r.branchSkip].sort()).toEqual(['L', 'n2', 'n3']);
    expect(r.branchSkip.has('n1')).toBe(false);
    expect([...r.glyphSkip].sort()).toEqual(['n1', 'n2', 'n3']);
    // Each pass-through node maps to the single segment so its shed stubs
    // merge into one marker.
    expect(r.anchorToSegment.get('n1')).toBe(0);
    expect(r.anchorToSegment.get('n2')).toBe(0);
    expect(r.anchorToSegment.get('n3')).toBe(0);
  });

  it('returns null for a fully branching tree (no single-child runs)', () => {
    // n0 forks to two leaves — no pass-through node anywhere.
    const nodes: TreeLayoutNode[] = [
      node('n0', null, 0, 12, false),
      node('a', 'n0', 100, 0, true),
      node('b', 'n0', 100, 24, true),
    ];
    expect(compressSpines(nodes, 'n0', { compressedWidth: 26 })).toBeNull();
  });

  it('leaves a lone single-child node alone (minChainLength 2)', () => {
    // n0 → n1 → L : only one pass-through node, below the default threshold.
    const nodes: TreeLayoutNode[] = [
      node('n0', null, 0, 12, false),
      node('K', 'n0', 10, 24, true),
      node('n1', 'n0', 10, 0, false),
      node('L', 'n1', 100, 0, true),
    ];
    expect(compressSpines(nodes, 'n0', { compressedWidth: 26 })).toBeNull();
  });

  it('treats excluded nodes as boundaries', () => {
    // Excluding n2 splits the run so neither side reaches the 2-node minimum.
    const res = compressSpines(spineNodes, 'n0', {
      compressedWidth: 26,
      exclude: new Set(['n2']),
    });
    expect(res).toBeNull();
  });
});
