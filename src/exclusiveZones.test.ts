import { describe, expect, it } from 'vitest';
import { buildInitialViewState } from './store';
import type { TBrowseProps, Tree, ZoneDefinition } from './types';

const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: true },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true },
  },
};

const Noop = () => null;

function zone(
  id: string,
  extra: Partial<ZoneDefinition> = {},
): ZoneDefinition {
  return {
    id,
    displayName: id,
    Header: Noop,
    Body: Noop,
    defaultWidth: 10,
    minWidth: 10,
    defaultZoneState: {},
    isAvailable: () => true,
    ...extra,
  } as ZoneDefinition;
}

const propsWith = (zones: ZoneDefinition[]): TBrowseProps =>
  ({ tree, zones }) as unknown as TBrowseProps;

const visibleIds = (zones: { id: string; visible: boolean }[]) =>
  zones.filter((z) => z.visible).map((z) => z.id);

describe('exclusive zone groups — initial view state', () => {
  it('lets at most one member of a group start visible', () => {
    const vs = buildInitialViewState(
      propsWith([
        zone('tree'),
        zone('msa', { exclusiveGroup: 'detail' }),
        zone('neighborhood', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ]),
    );
    expect(visibleIds(vs.zones)).toEqual(['tree', 'msa']);
  });

  it('picks the first member that actually qualifies', () => {
    // msa opts out via defaultVisible, so neighborhood claims the slot.
    const vs = buildInitialViewState(
      propsWith([
        zone('msa', { exclusiveGroup: 'detail', defaultVisible: false }),
        zone('neighborhood', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ]),
    );
    expect(visibleIds(vs.zones)).toEqual(['neighborhood']);
  });

  it('leaves independent groups and ungrouped zones alone', () => {
    const vs = buildInitialViewState(
      propsWith([
        zone('tree'),
        zone('labels'),
        zone('msa', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
        zone('a', { exclusiveGroup: 'other' }),
        zone('b', { exclusiveGroup: 'other' }),
      ]),
    );
    expect(visibleIds(vs.zones)).toEqual(['tree', 'labels', 'msa', 'a']);
  });

  it('respects data availability before claiming a group slot', () => {
    const vs = buildInitialViewState(
      propsWith([
        zone('msa', { exclusiveGroup: 'detail', isAvailable: () => false }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ]),
    );
    expect(visibleIds(vs.zones)).toEqual(['genome']);
  });

  it('starts with no group decoupled', () => {
    const vs = buildInitialViewState(
      propsWith([zone('msa', { exclusiveGroup: 'detail' })]),
    );
    expect(vs.unlinkedZoneGroups ?? []).toEqual([]);
  });
});
