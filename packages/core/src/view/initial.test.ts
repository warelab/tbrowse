import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_VIEW_STATE,
  applyPivot,
  buildInitialViewState,
  ensureZones,
  normalizeViewState,
  pixelWidthsToFr,
  softResetForNewTree,
} from './initial';
import { computePivotState } from '../tree/pivot';
import type { HostData, Tree, ViewState, ZoneSpec } from '../types';

const tree: Tree = {
  rootId: 'n0',
  nodes: {
    n0: { id: 'n0', parentId: null, distance: 0, isLeaf: false },
    n1: { id: 'n1', parentId: 'n0', distance: 1, isLeaf: true, geneId: 'GENE_A' },
    n2: { id: 'n2', parentId: 'n0', distance: 1, isLeaf: true, geneId: 'GENE_B' },
  },
};

const data: HostData = { tree };

function zone(id: string, extra: Partial<ZoneSpec> = {}): ZoneSpec {
  return {
    id,
    defaultWidth: 10,
    minWidth: 10,
    defaultZoneState: {},
    isAvailable: () => true,
    ...extra,
  };
}

const visibleIds = (zones: { id: string; visible: boolean }[]) =>
  zones.filter((z) => z.visible).map((z) => z.id);

// ---------------------------------------------------------------------------
// Cases replicated from tbrowse/src/store.test.ts (adapted to (zones, opts)).
// ---------------------------------------------------------------------------
describe('buildInitialViewState — density', () => {
  it('does NOT seed rowHeight / fontSize (keeps them prop-reactive)', () => {
    // Freezing them into view state would break prop-driven density (the
    // playground): they resolve at read time as viewState ?? prop ?? default.
    const vs = buildInitialViewState([], { data });
    expect(vs.rowHeight).toBeUndefined();
    expect(vs.fontSize).toBeUndefined();
    expect('rowHeight' in vs).toBe(false);
    expect('fontSize' in vs).toBe(false);
  });

  it('lets explicit overrides set the density (the Display control path)', () => {
    const vs = buildInitialViewState([], {
      data,
      overrides: { fontSize: 16, rowHeight: 30 },
    });
    expect(vs.fontSize).toBe(16);
    expect(vs.rowHeight).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Cases replicated from tbrowse/src/exclusiveZones.test.ts.
// ---------------------------------------------------------------------------
describe('exclusive zone groups — initial view state', () => {
  it('lets at most one member of a group start visible', () => {
    const vs = buildInitialViewState(
      [
        zone('tree'),
        zone('msa', { exclusiveGroup: 'detail' }),
        zone('neighborhood', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ],
      { data },
    );
    expect(visibleIds(vs.zones)).toEqual(['tree', 'msa']);
  });

  it('picks the first member that actually qualifies', () => {
    // msa opts out via defaultVisible, so neighborhood claims the slot.
    const vs = buildInitialViewState(
      [
        zone('msa', { exclusiveGroup: 'detail', defaultVisible: false }),
        zone('neighborhood', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ],
      { data },
    );
    expect(visibleIds(vs.zones)).toEqual(['neighborhood']);
  });

  it('leaves independent groups and ungrouped zones alone', () => {
    const vs = buildInitialViewState(
      [
        zone('tree'),
        zone('labels'),
        zone('msa', { exclusiveGroup: 'detail' }),
        zone('genome', { exclusiveGroup: 'detail' }),
        zone('a', { exclusiveGroup: 'other' }),
        zone('b', { exclusiveGroup: 'other' }),
      ],
      { data },
    );
    expect(visibleIds(vs.zones)).toEqual(['tree', 'labels', 'msa', 'a']);
  });

  it('respects data availability before claiming a group slot', () => {
    const vs = buildInitialViewState(
      [
        zone('msa', { exclusiveGroup: 'detail', isAvailable: () => false }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ],
      { data },
    );
    expect(visibleIds(vs.zones)).toEqual(['genome']);
  });

  it('starts with no group decoupled', () => {
    const vs = buildInitialViewState([zone('msa', { exclusiveGroup: 'detail' })], { data });
    expect(vs.unlinkedZoneGroups ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Additional buildInitialViewState behaviour.
// ---------------------------------------------------------------------------
describe('buildInitialViewState — options', () => {
  it('starts from EMPTY_VIEW_STATE with no zones and no opts', () => {
    const vs = buildInitialViewState([]);
    expect(vs).toEqual({ ...EMPTY_VIEW_STATE });
    expect(vs).not.toBe(EMPTY_VIEW_STATE);
  });

  it('seeds zoneStates from each zone defaultZoneState', () => {
    const labelsDefault = { visibleFields: ['geneId'] };
    const vs = buildInitialViewState([
      zone('tree', { defaultZoneState: { layoutMode: 'phylogram' } }),
      zone('labels', { defaultZoneState: labelsDefault }),
    ]);
    expect(vs.zoneStates).toEqual({
      tree: { layoutMode: 'phylogram' },
      labels: { visibleFields: ['geneId'] },
    });
    expect(vs.zoneStates['labels']).toBe(labelsDefault);
  });

  it('builds zone entries {id, width: defaultWidth, visible}', () => {
    const vs = buildInitialViewState([zone('tree', { defaultWidth: 30 }), zone('msa')]);
    expect(vs.zones).toEqual([
      { id: 'tree', width: 30, visible: true },
      { id: 'msa', width: 10, visible: true },
    ]);
  });

  it('visibility = (defaultVisible ?? true) && isAvailable(data)', () => {
    const vs = buildInitialViewState(
      [
        zone('a'),
        zone('b', { defaultVisible: false }),
        zone('c', { isAvailable: () => false }),
        zone('d', { defaultVisible: false, isAvailable: () => false }),
      ],
      { data },
    );
    expect(visibleIds(vs.zones)).toEqual(['a']);
  });

  it('passes the host data to isAvailable', () => {
    const isAvailable = vi.fn(() => true);
    const hd: HostData = { tree, msa: { alphabet: 'protein', length: 0, sequences: {} } };
    buildInitialViewState([zone('msa', { isAvailable })], { data: hd });
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(isAvailable).toHaveBeenCalledWith(hd);
  });

  it('skips the availability check (treats it as true) when data is omitted', () => {
    const isAvailable = vi.fn(() => false);
    const vs = buildInitialViewState([zone('msa', { isAvailable })]);
    expect(isAvailable).not.toHaveBeenCalled();
    expect(visibleIds(vs.zones)).toEqual(['msa']);
  });

  it('opts.visible overrides per zone', () => {
    const vs = buildInitialViewState(
      [zone('a'), zone('b', { defaultVisible: false }), zone('c', { isAvailable: () => false })],
      { data, visible: { a: false, b: true, c: true } },
    );
    expect(visibleIds(vs.zones)).toEqual(['b', 'c']);
  });

  it('applies opts.visible BEFORE the exclusive-group claim', () => {
    // Forcing msa hidden passes the slot to genome; forcing genome visible
    // in a group already claimed still loses to the first claimant.
    const vs = buildInitialViewState(
      [
        zone('msa', { exclusiveGroup: 'detail' }),
        zone('neighborhood', { exclusiveGroup: 'detail', defaultVisible: false }),
        zone('genome', { exclusiveGroup: 'detail' }),
      ],
      { data, visible: { msa: false, neighborhood: true } },
    );
    expect(visibleIds(vs.zones)).toEqual(['neighborhood']);
  });

  it('opts.widths overrides defaultWidth per zone', () => {
    const vs = buildInitialViewState([zone('tree', { defaultWidth: 30 }), zone('labels')], {
      widths: { tree: 270 },
    });
    expect(vs.zones.map((z) => z.width)).toEqual([270, 10]);
  });

  it('merges opts.zoneStates over the seeded defaults per zone', () => {
    const vs = buildInitialViewState(
      [
        zone('tree', { defaultZoneState: { layoutMode: 'phylogram', showLeafExtensions: true } }),
        zone('labels', { defaultZoneState: { visibleFields: ['geneId'] } }),
        zone('counts', { defaultZoneState: 7 }),
      ],
      {
        zoneStates: {
          tree: { layoutMode: 'cladogram' },
          counts: 42,
          custom: { foo: 1 },
        },
      },
    );
    expect(vs.zoneStates).toEqual({
      tree: { layoutMode: 'cladogram', showLeafExtensions: true },
      labels: { visibleFields: ['geneId'] },
      counts: 42,
      custom: { foo: 1 },
    });
  });

  it('overrides.zoneStates REPLACES the seeded map', () => {
    const vs = buildInitialViewState(
      [
        zone('tree', { defaultZoneState: { layoutMode: 'phylogram' } }),
        zone('labels', { defaultZoneState: { visibleFields: ['geneId'] } }),
      ],
      {
        zoneStates: { tree: { layoutMode: 'cladogram' } },
        overrides: { zoneStates: { labels: { visibleFields: ['x'] } } },
      },
    );
    expect(vs.zoneStates).toEqual({ labels: { visibleFields: ['x'] } });
  });

  it('applies a pivot when nodeOfInterest is given with data', () => {
    const expected = computePivotState(tree, 'GENE_B');
    const vs = buildInitialViewState([zone('tree')], { data, nodeOfInterest: 'GENE_B' });
    expect(expected).not.toBeNull();
    expect(vs.nodeOfInterestId).toBe('n2');
    expect(vs.collapsedNodeIds).toEqual(expected!.collapsedNodeIds);
    expect(vs.swappedNodeIds).toEqual(expected!.swappedNodeIds);
    expect(vs.swappedNodeIds).toEqual(['n0']);
  });

  it('leaves the pivot fields empty when the identifier does not resolve', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const vs = buildInitialViewState([zone('tree')], { data, nodeOfInterest: 'NOPE' });
      expect(vs.nodeOfInterestId).toBeNull();
      expect(vs.collapsedNodeIds).toEqual([]);
      expect(vs.swappedNodeIds).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('ignores nodeOfInterest when no data (tree) is supplied', () => {
    const vs = buildInitialViewState([zone('tree')], { nodeOfInterest: 'GENE_B' });
    expect(vs.nodeOfInterestId).toBeNull();
    expect(vs.collapsedNodeIds).toEqual([]);
  });

  it('spreads overrides last, verbatim', () => {
    const vs = buildInitialViewState(
      [zone('tree', { exclusiveGroup: 'g' }), zone('msa', { exclusiveGroup: 'g' })],
      {
        data,
        nodeOfInterest: 'GENE_B',
        widths: { tree: 99 },
        visible: { tree: false },
        overrides: {
          nodeOfInterestId: 'n1',
          swappedNodeIds: [],
          selectedNodeId: 'n1',
          zones: [{ id: 'only', width: 1, visible: false }],
          unlinkedZoneGroups: ['g'],
          search: { query: 'q' },
        },
      },
    );
    expect(vs.nodeOfInterestId).toBe('n1');
    expect(vs.swappedNodeIds).toEqual([]);
    expect(vs.selectedNodeId).toBe('n1');
    expect(vs.zones).toEqual([{ id: 'only', width: 1, visible: false }]);
    expect(vs.unlinkedZoneGroups).toEqual(['g']);
    expect(vs.search).toEqual({ query: 'q' });
  });
});

// ---------------------------------------------------------------------------
// applyPivot
// ---------------------------------------------------------------------------
describe('applyPivot', () => {
  const base: ViewState = {
    ...EMPTY_VIEW_STATE,
    selectedNodeId: 'n1',
    collapsedNodeIds: ['old'],
    swappedNodeIds: ['old'],
    nodeOfInterestId: 'old',
    zones: [{ id: 'tree', width: 1, visible: true }],
  };

  it('returns the same reference for a null pivot', () => {
    expect(applyPivot(base, null)).toBe(base);
  });

  it('replaces collapsed/swapped/nodeOfInterest and keeps the rest', () => {
    const next = applyPivot(base, {
      collapsedNodeIds: ['c'],
      swappedNodeIds: ['s'],
      targetId: 't',
    });
    expect(next).not.toBe(base);
    expect(next.collapsedNodeIds).toEqual(['c']);
    expect(next.swappedNodeIds).toEqual(['s']);
    expect(next.nodeOfInterestId).toBe('t');
    expect(next.selectedNodeId).toBe('n1');
    expect(next.zones).toBe(base.zones);
  });
});

// ---------------------------------------------------------------------------
// softResetForNewTree
// ---------------------------------------------------------------------------
describe('softResetForNewTree', () => {
  it('clears node-bound fields and keeps layout fields', () => {
    const zones = [{ id: 'tree', width: 30, visible: true }];
    const zoneStates = { tree: { layoutMode: 'cladogram' } };
    const vs: ViewState = {
      selectedNodeId: 'n1',
      collapsedNodeIds: ['n0'],
      prunedNodeIds: ['n2'],
      swappedNodeIds: ['n0'],
      compressedNodeIds: ['n1'],
      nodeOfInterestId: 'n1',
      zones,
      zoneStates,
      rowHeight: 18,
      fontSize: 11,
      unlinkedZoneGroups: ['detail'],
      search: { query: 'x', regex: true },
    };
    const next = softResetForNewTree(vs);
    expect(next).toEqual({
      selectedNodeId: null,
      collapsedNodeIds: [],
      prunedNodeIds: [],
      swappedNodeIds: [],
      compressedNodeIds: [],
      nodeOfInterestId: null,
      zones,
      zoneStates,
      rowHeight: 18,
      fontSize: 11,
      unlinkedZoneGroups: ['detail'],
      search: null,
    });
    expect(next.zones).toBe(zones);
    expect(next.zoneStates).toBe(zoneStates);
  });
});

// ---------------------------------------------------------------------------
// ensureZones
// ---------------------------------------------------------------------------
describe('ensureZones', () => {
  it('returns the same reference when every zone has an entry and none is unknown', () => {
    const vs: ViewState = {
      ...EMPTY_VIEW_STATE,
      zones: [
        { id: 'b', width: 2, visible: false },
        { id: 'a', width: 1, visible: true },
      ],
    };
    expect(ensureZones(vs, [zone('a'), zone('b')])).toBe(vs);
  });

  it('appends missing zones (defaultWidth, defaultVisible ?? true) after the known ones', () => {
    const vs: ViewState = {
      ...EMPTY_VIEW_STATE,
      zones: [{ id: 'a', width: 1, visible: false }],
    };
    const next = ensureZones(vs, [
      zone('b', { defaultWidth: 20, defaultVisible: false }),
      zone('a'),
      zone('c', { defaultWidth: 30 }),
    ]);
    expect(next.zones).toEqual([
      { id: 'a', width: 1, visible: false },
      { id: 'b', width: 20, visible: false },
      { id: 'c', width: 30, visible: true },
    ]);
  });

  it('drops entries for unknown zone ids, preserving the order of known ones', () => {
    const vs: ViewState = {
      ...EMPTY_VIEW_STATE,
      zones: [
        { id: 'c', width: 3, visible: true },
        { id: 'gone', width: 9, visible: true },
        { id: 'a', width: 1, visible: true, userToggled: true },
      ],
      zoneStates: { gone: { keep: 'me' } },
    };
    const next = ensureZones(vs, [zone('a'), zone('c')]);
    expect(next.zones).toEqual([
      { id: 'c', width: 3, visible: true },
      { id: 'a', width: 1, visible: true, userToggled: true },
    ]);
    // zoneStates is not touched.
    expect(next.zoneStates).toBe(vs.zoneStates);
  });
});

// ---------------------------------------------------------------------------
// normalizeViewState
// ---------------------------------------------------------------------------
describe('normalizeViewState', () => {
  it('turns garbage into EMPTY_VIEW_STATE', () => {
    for (const input of [undefined, null, 42, 'str', [], true]) {
      expect(normalizeViewState(input)).toEqual({ ...EMPTY_VIEW_STATE });
    }
  });

  it('fills missing arrays with [] and missing search with null', () => {
    const vs = normalizeViewState({ selectedNodeId: 'n1' });
    expect(vs).toEqual({ ...EMPTY_VIEW_STATE, selectedNodeId: 'n1' });
  });

  it('drops unknown fields and malformed values', () => {
    const vs = normalizeViewState({
      selectedNodeId: 7,
      collapsedNodeIds: 'nope',
      prunedNodeIds: ['a', 3, 'b'],
      nodeOfInterestId: 'n2',
      zones: 'bad',
      zoneStates: [],
      search: { noQuery: true },
      rowHeight: 'big',
      fontSize: 13,
      unlinkedZoneGroups: ['g', 1],
      legacyField: 1,
    });
    expect(vs).toEqual({
      ...EMPTY_VIEW_STATE,
      prunedNodeIds: ['a', 'b'],
      nodeOfInterestId: 'n2',
      fontSize: 13,
      unlinkedZoneGroups: ['g'],
    });
    expect('legacyField' in vs).toBe(false);
    expect('rowHeight' in vs).toBe(false);
  });

  it('keeps zoneStates as-is, including unknown zone keys', () => {
    const zoneStates = { tree: { layoutMode: 'cladogram' }, mystery: { x: 1 } };
    const vs = normalizeViewState({ zoneStates }, [zone('tree')]);
    expect(vs.zoneStates).toBe(zoneStates);
  });

  it('keeps a well-formed search and strips unknown search fields', () => {
    const vs = normalizeViewState({
      search: { query: 'abc', excludedFields: ['f'], caseSensitive: true, regex: 'no', junk: 1 },
    });
    expect(vs.search).toEqual({ query: 'abc', excludedFields: ['f'], caseSensitive: true });
  });

  it('normalises zone entries, dropping those without a string id', () => {
    const vs = normalizeViewState({
      zones: [
        { id: 'tree', width: 30, visible: true, userToggled: true },
        { id: 'labels', width: 'wide' },
        { width: 5, visible: true },
        null,
      ],
    });
    expect(vs.zones).toEqual([
      { id: 'tree', width: 30, visible: true, userToggled: true },
      { id: 'labels', width: 25, visible: true },
    ]);
  });

  it('runs ensureZones when zones are given', () => {
    const vs = normalizeViewState(
      { zones: [{ id: 'gone', width: 1, visible: true }, { id: 'labels', width: 20, visible: false }] },
      [zone('tree', { defaultWidth: 30 }), zone('labels')],
    );
    expect(vs.zones).toEqual([
      { id: 'labels', width: 20, visible: false },
      { id: 'tree', width: 30, visible: true },
    ]);
  });

  it('round-trips a full state through JSON unchanged', () => {
    const full: ViewState = {
      selectedNodeId: 'n1',
      collapsedNodeIds: ['n0'],
      prunedNodeIds: ['n2'],
      swappedNodeIds: ['n0'],
      compressedNodeIds: ['n1'],
      nodeOfInterestId: 'n1',
      zones: [{ id: 'tree', width: 30, visible: true, userToggled: true }],
      zoneStates: { tree: { layoutMode: 'cladogram' } },
      rowHeight: 18,
      fontSize: 11,
      unlinkedZoneGroups: ['detail'],
      search: { query: 'x', excludedFields: ['a'], caseSensitive: false, regex: true },
    };
    expect(normalizeViewState(JSON.parse(JSON.stringify(full)))).toEqual(full);
  });
});

// ---------------------------------------------------------------------------
// pixelWidthsToFr
// ---------------------------------------------------------------------------
describe('pixelWidthsToFr', () => {
  it('gives each target zone its px and the flex zone the remainder', () => {
    expect(pixelWidthsToFr({ tree: 270, labels: 200, counts: 64 }, 1200, 'bins')).toEqual({
      tree: 270,
      labels: 200,
      counts: 64,
      bins: 1200 - 534,
    });
  });

  it('clamps the flex zone to minFlexPx (default 160)', () => {
    expect(pixelWidthsToFr({ tree: 270, labels: 200, counts: 64 }, 600, 'bins')).toEqual({
      tree: 270,
      labels: 200,
      counts: 64,
      bins: 160,
    });
    expect(pixelWidthsToFr({ tree: 500 }, 600, 'bins', 300)['bins']).toBe(300);
  });

  it('ignores a target for the flex zone itself', () => {
    expect(pixelWidthsToFr({ tree: 100, bins: 999 }, 400, 'bins')).toEqual({ tree: 100, bins: 300 });
  });

  it('handles an empty target map', () => {
    expect(pixelWidthsToFr({}, 400, 'bins')).toEqual({ bins: 400 });
  });
});

// ---------------------------------------------------------------------------
// EMPTY_VIEW_STATE
// ---------------------------------------------------------------------------
describe('EMPTY_VIEW_STATE', () => {
  it('is frozen and empty', () => {
    expect(Object.isFrozen(EMPTY_VIEW_STATE)).toBe(true);
    expect(EMPTY_VIEW_STATE.zones).toEqual([]);
    expect(EMPTY_VIEW_STATE.search).toBeNull();
  });
});
