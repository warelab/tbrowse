import { describe, expect, it } from 'vitest';
import { computeTreeLayout } from './layout';
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
