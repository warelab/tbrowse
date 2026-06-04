import { describe, expect, it } from 'vitest';
import { computeVisibleRows, LEAF_ROW_HEIGHT, SUMMARY_ROW_HEIGHT } from './visibleRows';
import type { Tree } from './types';

// Sample tree:
//   n0
//   ├── n1
//   │   ├── n3
//   │   │   ├── n4 (leaf)
//   │   │   └── n5 (leaf)
//   │   └── n6 (leaf)
//   └── n2 (leaf)
const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: false },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true },
    n3: { id: 'n3', parentId: 'n1', distance: 1, isLeaf: false },
    n4: { id: 'n4', parentId: 'n3', distance: 1, isLeaf: true },
    n5: { id: 'n5', parentId: 'n3', distance: 1, isLeaf: true },
    n6: { id: 'n6', parentId: 'n1', distance: 1, isLeaf: true },
  },
};

const empty = new Set<string>();

describe('computeVisibleRows', () => {
  it('returns one row per leaf in tree-traversal order', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: empty,
      prunedNodeIds: empty,
    });
    expect(rows.map((r) => r.nodeId)).toEqual(['n4', 'n5', 'n6', 'n2']);
    expect(rows.every((r) => r.kind === 'leaf')).toBe(true);
    expect(rows.map((r) => r.y)).toEqual([0, 24, 48, 72]);
    expect(rows.every((r) => r.height === LEAF_ROW_HEIGHT)).toBe(true);
  });

  it('honors a custom rowHeight for leaf and summary rows', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: empty,
      prunedNodeIds: empty,
      rowHeight: 16,
    });
    expect(rows.every((r) => r.height === 16)).toBe(true);
    expect(rows.map((r) => r.y)).toEqual([0, 16, 32, 48]);

    const collapsed = computeVisibleRows({
      tree,
      collapsedNodeIds: new Set(['n3']),
      prunedNodeIds: empty,
      rowHeight: 16,
    });
    // n3 collapses to a summary row that must also use the custom height.
    const summary = collapsed.find((r) => r.kind === 'collapsedSummary');
    expect(summary?.height).toBe(16);
  });

  it('replaces a collapsed subtree with a single summary row', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: new Set(['n3']),
      prunedNodeIds: empty,
    });
    expect(rows.map((r) => r.nodeId)).toEqual(['n3', 'n6', 'n2']);
    expect(rows[0].kind).toBe('collapsedSummary');
    expect(rows[0].leafCount).toBe(2);
    expect(rows[0].height).toBe(SUMMARY_ROW_HEIGHT);
    // Summary row pushes subsequent rows down by exactly one row height.
    expect(rows.map((r) => r.y)).toEqual([0, 24, 48]);
  });

  it('omits pruned subtrees entirely', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: empty,
      prunedNodeIds: new Set(['n3']),
    });
    expect(rows.map((r) => r.nodeId)).toEqual(['n6', 'n2']);
    // y values pack tightly — pruning leaves no gap.
    expect(rows.map((r) => r.y)).toEqual([0, 24]);
  });

  it('reverses children of swapped nodes', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: empty,
      prunedNodeIds: empty,
      swappedNodeIds: new Set(['n0']),
    });
    // Original: [n4, n5, n6, n2]. Swap n0 → its children become [n2, n1].
    // Walking [n2, n1] yields [n2, n4, n5, n6].
    expect(rows.map((r) => r.nodeId)).toEqual(['n2', 'n4', 'n5', 'n6']);
  });

  it('composes collapse + prune + swap', () => {
    // Swap n1 → children become [n6, n3]. Collapse n3 → summary row.
    // Prune nothing.
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: new Set(['n3']),
      prunedNodeIds: empty,
      swappedNodeIds: new Set(['n1']),
    });
    expect(rows.map((r) => ({ id: r.nodeId, kind: r.kind }))).toEqual([
      { id: 'n6', kind: 'leaf' },
      { id: 'n3', kind: 'collapsedSummary' },
      { id: 'n2', kind: 'leaf' },
    ]);
  });

  it('returns empty array when the entire tree is pruned', () => {
    const rows = computeVisibleRows({
      tree,
      collapsedNodeIds: empty,
      prunedNodeIds: new Set(['n0']),
    });
    expect(rows).toEqual([]);
  });

  it('handles a single-leaf tree', () => {
    const single: Tree = {
      rootId: 'leaf',
      nodes: {
        leaf: { id: 'leaf', parentId: null, distance: 0, isLeaf: true },
      },
    };
    const rows = computeVisibleRows({
      tree: single,
      collapsedNodeIds: empty,
      prunedNodeIds: empty,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].nodeId).toBe('leaf');
  });
});
