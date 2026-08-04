import { describe, expect, it } from 'vitest';
import { buildInitialViewState, DEFAULT_FONT_SIZE } from './store';
import type { TBrowseProps, Tree } from './types';

const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: true },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true },
  },
};

const propsWith = (extra: Partial<TBrowseProps>): TBrowseProps =>
  ({ tree, zones: [], ...extra }) as unknown as TBrowseProps;

describe('buildInitialViewState — density', () => {
  it('does NOT seed rowHeight / fontSize from props (keeps them prop-reactive)', () => {
    // Freezing them into view state would break prop-driven density (the
    // playground): they resolve at read time as viewState ?? prop ?? default.
    const vs = buildInitialViewState(propsWith({ fontSize: 10, rowHeight: 14 }));
    expect(vs.rowHeight).toBeUndefined();
    expect(vs.fontSize).toBeUndefined();
  });

  it('lets an explicit initialViewState set the density (the Display control path)', () => {
    const vs = buildInitialViewState(
      propsWith({ fontSize: 10, initialViewState: { fontSize: 16, rowHeight: 30 } }),
    );
    expect(vs.fontSize).toBe(16);
    expect(vs.rowHeight).toBe(30);
  });

  it('keeps DEFAULT_FONT_SIZE available as the read-time fallback', () => {
    expect(DEFAULT_FONT_SIZE).toBe(12);
  });
});
