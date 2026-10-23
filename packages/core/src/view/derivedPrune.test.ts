import { describe, expect, it } from 'vitest';
import {
  createDerivedPruneLayer,
  mergeDerivedPrunes,
  stripDerivedPrunes,
  stripPrunesForSnapshot,
} from './derivedPrune';
import { EMPTY_VIEW_STATE } from './initial';
import type { ViewState } from '../types';

const base: ViewState = {
  ...EMPTY_VIEW_STATE,
  selectedNodeId: 'sel',
  prunedNodeIds: ['u1', 'u2', 'shared'],
  zones: [{ id: 'tree', width: 1, visible: true }],
};

describe('mergeDerivedPrunes', () => {
  it('returns the same reference when derived is empty', () => {
    expect(mergeDerivedPrunes(base, [])).toBe(base);
  });

  it('unions user prunes first, then derived, without duplicates', () => {
    const next = mergeDerivedPrunes(base, ['d1', 'shared', 'd2', 'd1']);
    expect(next).not.toBe(base);
    expect(next.prunedNodeIds).toEqual(['u1', 'u2', 'shared', 'd1', 'd2']);
    expect(next.selectedNodeId).toBe('sel');
    expect(next.zones).toBe(base.zones);
    // Input untouched.
    expect(base.prunedNodeIds).toEqual(['u1', 'u2', 'shared']);
  });

  it('de-duplicates the user list like _.union does', () => {
    const next = mergeDerivedPrunes({ ...base, prunedNodeIds: ['a', 'a', 'b'] }, ['c']);
    expect(next.prunedNodeIds).toEqual(['a', 'b', 'c']);
  });

  it('tolerates an old blob with no prunedNodeIds', () => {
    const old = { ...base } as Partial<ViewState>;
    delete old.prunedNodeIds;
    expect(mergeDerivedPrunes(old as ViewState, ['d']).prunedNodeIds).toEqual(['d']);
  });
});

describe('stripDerivedPrunes', () => {
  it('returns the same reference when derived is empty', () => {
    expect(stripDerivedPrunes(base, [])).toBe(base);
  });

  it('filters out derived ids, keeping user ids in order', () => {
    const merged = mergeDerivedPrunes(base, ['d1', 'd2']);
    const stripped = stripDerivedPrunes(merged, ['d1', 'd2']);
    expect(stripped.prunedNodeIds).toEqual(['u1', 'u2', 'shared']);
    expect(stripped.selectedNodeId).toBe('sel');
  });

  it('removes an id that is both user- and control-derived', () => {
    // Matches Homology.js: the genome set wins on the way out.
    expect(stripDerivedPrunes(base, ['shared']).prunedNodeIds).toEqual(['u1', 'u2']);
  });

  it('tolerates an old blob with no prunedNodeIds', () => {
    const old = { ...base } as Partial<ViewState>;
    delete old.prunedNodeIds;
    expect(stripDerivedPrunes(old as ViewState, ['d']).prunedNodeIds).toEqual([]);
  });
});

describe('createDerivedPruneLayer', () => {
  it('exposes the derived list', () => {
    const derived = ['d1'];
    expect(createDerivedPruneLayer(derived).derived).toBe(derived);
  });

  it('with an empty list both transforms are identity (stable references)', () => {
    const layer = createDerivedPruneLayer([]);
    expect(layer.effective(base)).toBe(base);
    expect(layer.onChange(base)).toBe(base);
  });

  it('effective merges and onChange strips', () => {
    const layer = createDerivedPruneLayer(['d1', 'd2']);
    const eff = layer.effective(base);
    expect(eff.prunedNodeIds).toEqual(['u1', 'u2', 'shared', 'd1', 'd2']);
    // The viewer reports a change (user pruned one more node).
    const reported = { ...eff, prunedNodeIds: [...eff.prunedNodeIds, 'u3'] };
    expect(layer.onChange(reported).prunedNodeIds).toEqual(['u1', 'u2', 'shared', 'u3']);
  });

  it('round-trips: onChange(effective(vs)) equals vs', () => {
    const layer = createDerivedPruneLayer(['d1']);
    expect(layer.onChange(layer.effective(base))).toEqual(base);
  });
});

describe('stripPrunesForSnapshot', () => {
  it('empties prunedNodeIds and keeps everything else', () => {
    const snap = stripPrunesForSnapshot(base);
    expect(snap).not.toBe(base);
    expect(snap).toEqual({ ...base, prunedNodeIds: [] });
    expect(snap.zones).toBe(base.zones);
  });
});
