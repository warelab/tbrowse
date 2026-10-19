/**
 * Control-derived prunes layered over user prunes. A host that hides nodes
 * because of a filter (gramene-search's genome limit, TaxDist's
 * collapse-empties / compara-only toggles) wants those prunes in the view
 * state it RENDERS but not in the state it PERSISTS, so the filter can be
 * changed later and re-applied cleanly.
 *
 * Origins: `gramene-search/src/components/results/details/Homology.js:411-428`
 * (merge on the way in, strip on the way out),
 * `TaxDistTbrowse.js:170-175` (the memoised effective state), and
 * `src/bundles/viewSnapshot.js:313-327` (prunes stripped from snapshots).
 */
import type { NodeId, ViewState } from '../types';

/**
 * Union `derived` into `vs.prunedNodeIds`, keeping the user's ids first (in
 * their order, de-duplicated) and appending derived ids not already present
 * — the semantics of lodash's `_.union(user, derived)` in `Homology.js:417`.
 * Returns `vs` itself (same reference) when `derived` is empty, so a memo
 * keyed on the result stays stable while no filter is active.
 */
export function mergeDerivedPrunes(vs: ViewState, derived: readonly NodeId[]): ViewState {
  if (derived.length === 0) return vs;
  const seen = new Set<NodeId>();
  const merged: NodeId[] = [];
  for (const id of vs.prunedNodeIds ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  for (const id of derived) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return { ...vs, prunedNodeIds: merged };
}

/**
 * Remove every id in `derived` from `vs.prunedNodeIds`, leaving only the
 * user's own prunes (origin `Homology.js:420-426`). Returns `vs` itself when
 * `derived` is empty.
 */
export function stripDerivedPrunes(vs: ViewState, derived: readonly NodeId[]): ViewState {
  if (derived.length === 0) return vs;
  const derivedSet = new Set<NodeId>(derived);
  return {
    ...vs,
    prunedNodeIds: (vs.prunedNodeIds ?? []).filter((id) => !derivedSet.has(id)),
  };
}

/**
 * A fixed set of derived prunes packaged as the two transforms a controlled
 * viewer needs: `effective(vs)` is what to render (user state + derived
 * prunes) and `onChange(next)` is what to store when the viewer reports a
 * change (derived prunes removed again).
 */
export interface DerivedPruneLayer {
  readonly derived: readonly NodeId[];
  effective(vs: ViewState): ViewState;
  onChange(next: ViewState): ViewState;
}

/**
 * Build a {@link DerivedPruneLayer} for `derived`. With an empty list both
 * transforms return their argument unchanged (same reference), matching
 * `Homology.js:416-428` where the layer is bypassed entirely when there are
 * no genome-derived prunes.
 */
export function createDerivedPruneLayer(derived: readonly NodeId[]): DerivedPruneLayer {
  return {
    derived,
    effective: (vs) => mergeDerivedPrunes(vs, derived),
    onChange: (next) => stripDerivedPrunes(next, derived),
  };
}

/**
 * Drop every prune from a view state about to be persisted in a snapshot:
 * `prunedNodeIds` becomes `[]`, everything else is copied. For hosts whose
 * prunes are entirely control-derived and recomputed on restore. Origin:
 * `gramene-search/src/bundles/viewSnapshot.js:325`.
 */
export function stripPrunesForSnapshot(vs: ViewState): ViewState {
  return { ...vs, prunedNodeIds: [] };
}
