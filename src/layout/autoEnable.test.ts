import { describe, expect, it } from 'vitest';
import { autoEnableZones } from './autoEnable';
import type { HostData, Tree, ViewState, ZoneDefinition } from '../types';
import { EMPTY_VIEW_STATE } from 'tbrowse-core';

const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: true },
  },
};
const Noop = () => null;

/** `isAvailable` reads `hostData[id]`, so each test says which zones have data. */
function zone(id: string, extra: Partial<ZoneDefinition> = {}): ZoneDefinition {
  return {
    id,
    displayName: id,
    Header: Noop,
    Body: Noop,
    defaultWidth: 10,
    minWidth: 10,
    defaultZoneState: {},
    isAvailable: (d) => d.hostData?.[id] === true,
    ...extra,
  } as ZoneDefinition;
}
const dataWith = (...ids: string[]): HostData => ({ tree, hostData: Object.fromEntries(ids.map((id) => [id, true])) });
const vsWith = (zones: ViewState['zones'], extra: Partial<ViewState> = {}): ViewState => ({ ...EMPTY_VIEW_STATE, zones, ...extra });
const visibleIds = (vs: ViewState) => vs.zones.filter((z) => z.visible).map((z) => z.id);

const tree_ = zone('tree');
const msa = zone('msa', { exclusiveGroup: 'detail' });
const genotype = zone('genotype', { exclusiveGroup: 'detail' });
const zones = [tree_, msa, genotype];

describe('autoEnableZones', () => {
  it('reveals a newly available hidden zone and returns the same object when nothing changes', () => {
    const vs = vsWith([{ id: 'tree', width: 10, visible: false }]);
    const next = autoEnableZones(vs, zones, ['tree'], dataWith('tree'));
    expect(visibleIds(next)).toEqual(['tree']);
    expect(autoEnableZones(next, zones, ['tree'], dataWith('tree'))).toBe(next);
    expect(autoEnableZones(vs, zones, [], dataWith('tree'))).toBe(vs);
  });

  it('keeps a hidden zone hidden when a rendering sibling holds the group slot', () => {
    const vs = vsWith([
      { id: 'msa', width: 10, visible: true },
      { id: 'genotype', width: 10, visible: false },
    ]);
    const next = autoEnableZones(vs, zones, ['genotype'], dataWith('msa', 'genotype'));
    expect(visibleIds(next)).toEqual(['msa']);
  });

  it('ignores a visible sibling whose data is absent — a stale flag does not hold the slot', () => {
    // The playground seeds every zone visible; after a BrAPI load the MSA
    // zone is still flagged visible but has no alignment, so it does not
    // render and must not keep the genotype zone off the row.
    const vs = vsWith([
      { id: 'msa', width: 10, visible: true },
      { id: 'genotype', width: 10, visible: false },
    ]);
    const next = autoEnableZones(vs, zones, ['genotype'], dataWith('genotype'));
    expect(visibleIds(next)).toEqual(['msa', 'genotype']);
  });

  it('reveals at most one member of a linked group per pass, in zone order', () => {
    const vs = vsWith([
      { id: 'msa', width: 10, visible: false },
      { id: 'genotype', width: 10, visible: false },
    ]);
    const next = autoEnableZones(vs, zones, ['msa', 'genotype'], dataWith('msa', 'genotype'));
    expect(visibleIds(next)).toEqual(['msa']);
  });

  it('treats an unlinked group like plain zones', () => {
    const vs = vsWith(
      [
        { id: 'msa', width: 10, visible: true },
        { id: 'genotype', width: 10, visible: false },
      ],
      { unlinkedZoneGroups: ['detail'] },
    );
    const next = autoEnableZones(vs, zones, ['genotype'], dataWith('msa', 'genotype'));
    expect(visibleIds(next)).toEqual(['msa', 'genotype']);
  });

  it('never reveals a zone the user toggled off', () => {
    const vs = vsWith([{ id: 'genotype', width: 10, visible: false, userToggled: true }]);
    expect(autoEnableZones(vs, zones, ['genotype'], dataWith('genotype'))).toBe(vs);
  });

  it('appends an entry for a zone the list is missing, honouring the group slot', () => {
    const vs = vsWith([{ id: 'msa', width: 10, visible: true }]);
    const blocked = autoEnableZones(vs, zones, ['genotype'], dataWith('msa', 'genotype'));
    expect(blocked.zones).toEqual([
      { id: 'msa', width: 10, visible: true },
      { id: 'genotype', width: 10, visible: false },
    ]);
    const free = autoEnableZones(vs, zones, ['genotype'], dataWith('genotype'));
    expect(free.zones[1]).toEqual({ id: 'genotype', width: 10, visible: true });
  });
});
