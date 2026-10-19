import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  applyPivot,
  buildInitialViewState,
  ensureZones,
  softResetForNewTree,
  type HostData,
  type InitialViewStateOptions,
  type LoaderSnapshot,
  type ViewState,
  type ZoneSpec,
} from 'tbrowse-core';

/**
 * What to do with the view state when a loader's root becomes ready:
 * - `'reset'`: `buildInitialViewState(zones, opts)` then `applyPivot` — a fresh view.
 * - `'soft'`: `softResetForNewTree(prev)` then `applyPivot` — keeps zone widths,
 *   visibility and per-zone state (the playground's source/gene switch).
 * - `'keep'`: previous state untouched, no pivot (a mirror switch, or a
 *   URL-hash bootstrap whose stored view must win over the pivot).
 */
export type RootReadyMode = 'reset' | 'soft' | 'keep';

export interface UseInitialViewStateOptions extends InitialViewStateOptions {
  /**
   * Called once per root (a new `snapshot.tree` object) when it becomes ready.
   * Default: `'reset'` when there is no previous state, else `'soft'`.
   */
  onRootReady?: (snapshot: LoaderSnapshot<any>, prev: ViewState | null) => RootReadyMode;
  /**
   * Initial state before any root is ready — e.g. the view state decoded
   * from the URL hash. With `onRootReady` returning `'keep'` for the first
   * generation it survives the first root.
   */
  initial?: ViewState | null;
}

/**
 * A controlled `ViewState` that follows a loader: it is (re)built when a
 * root becomes ready, according to `onRootReady`, and kept in step with the
 * zone list (`ensureZones`) when zones are added or removed. Returns the
 * usual `[viewState, setViewState]` pair to wire to `<TBrowse viewState
 * onViewStateChange>`; `viewState` is `null` until something built it.
 */
export function useInitialViewState(
  zones: readonly ZoneSpec[],
  snapshot: LoaderSnapshot<any> | null,
  opts: UseInitialViewStateOptions = {},
): [ViewState | null, Dispatch<SetStateAction<ViewState | null>>] {
  const [viewState, setViewState] = useState<ViewState | null>(opts.initial ?? null);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // Seed once per ROOT: keyed on the tree object rather than
  // `snapshot.generation`, because a new loader (new source identity)
  // restarts at generation 1 while its first root is still a new root, and
  // a slot's `patchMeta` replaces `snapshot.root` but keeps the same tree.
  const seededTree = useRef<object | null>(null);

  const build = useCallback(
    (snap: LoaderSnapshot<any>): ViewState => {
      const o = optsRef.current;
      // `isAvailable` sees the loader's data unless the host supplies its own bag,
      // matching what the chassis does in uncontrolled mode.
      const data: HostData | undefined =
        o.data ?? (snap.tree ? ({ tree: snap.tree, ...snap.data } as HostData) : undefined);
      return buildInitialViewState(zones, {
        ...(data !== undefined ? { data } : {}),
        ...(o.nodeOfInterest !== undefined ? { nodeOfInterest: o.nodeOfInterest } : {}),
        ...(o.widths !== undefined ? { widths: o.widths } : {}),
        ...(o.visible !== undefined ? { visible: o.visible } : {}),
        ...(o.zoneStates !== undefined ? { zoneStates: o.zoneStates } : {}),
        ...(o.overrides !== undefined ? { overrides: o.overrides } : {}),
      });
    },
    [zones],
  );

  useEffect(() => {
    if (!snapshot || snapshot.status !== 'ready' || !snapshot.tree) return;
    if (seededTree.current === snapshot.tree) return;
    seededTree.current = snapshot.tree;
    setViewState((prev) => {
      const mode = optsRef.current.onRootReady?.(snapshot, prev) ?? (prev === null ? 'reset' : 'soft');
      if (mode === 'keep') return prev ?? ensureZones(build(snapshot), zones);
      const base = mode === 'soft' && prev ? softResetForNewTree(prev) : build(snapshot);
      return applyPivot(ensureZones(base, zones), snapshot.pivot);
    });
  }, [snapshot, zones, build]);

  // Keep the zone list in step when zones are added or removed at runtime.
  useEffect(() => {
    setViewState((prev) => (prev ? ensureZones(prev, zones) : prev));
  }, [zones]);

  return [viewState, setViewState];
}
