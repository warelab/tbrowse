/**
 * The `Loader`: runs a `TreeDataSource` (root load, then its data slots)
 * and exposes a `LoaderSnapshot` that a React host subscribes to with
 * `useSyncExternalStore`, or that a script simply awaits.
 *
 * Rules (each one tested in `loader.test.ts`):
 *  (a) sources receive `withRetry(options.fetch ?? defaultFetch, options.retry)`;
 *  (b) a throwing slot `run` → that slot `'error'`, nothing else affected;
 *  (c) non-empty `itemErrorsOf` → `'ready'` + `itemErrors`, unless
 *      `failWhen` returns a message → `'error'` (value kept);
 *  (d) `mergeHostData`: top-level later-wins, `hostData` merged one level
 *      deep, `console.warn` on overwrite when `warnOnOverwrite`;
 *  (e) results from a stale generation are discarded (`start()` aborts the
 *      previous generation's `AbortController`);
 *  (f) snapshot objects are replaced only when a field changes;
 *  (g) `zoneStatus` is recomputed from `zoneSlots` on every slot transition.
 *
 * New in 0.2: nothing here is lifted from the playground; the generation /
 * abort bookkeeping replaces the ad-hoc `useEffect` cancellation flags of
 * `examples/playground/main.tsx`.
 */
import type { HostDataPatch, Taxonomy, Tree, ZoneStatus, ZoneStatusMap } from '../types';
import { computePivotState } from '../tree/pivot';
import type { FanOutProgress } from '../fetch/fanOut';
import { defaultFetch, withRetry } from '../fetch/retry';
import type {
  DataSlot,
  Loader,
  LoaderOptions,
  LoaderSnapshot,
  RootResult,
  SlotState,
  TreeDataSource,
} from './types';

const IDLE: SlotState = Object.freeze({
  status: 'idle',
  value: undefined,
  error: null,
  progress: null,
  itemErrors: null,
}) as SlotState;

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** Shallow key/value equality for plain records (used to keep references stable). */
function shallowEqualRecord(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!(k in b) || a[k] !== b[k]) return false;
  }
  return true;
}

const sameProgress = (a: FanOutProgress | null, b: FanOutProgress): boolean =>
  a !== null && a.done === b.done && a.total === b.total && a.failed === b.failed;

/**
 * Settles as `promise` does, or rejects with `Error('aborted')` as soon as
 * `signal` aborts — so `start()` / `load()` resolve promptly on `abort()`
 * even when a source ignores its signal. A late settlement of `promise`
 * is swallowed (its outcome belongs to a stale epoch anyway).
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Merges one host-data patch over another. Top-level keys are later-wins;
 * the opaque `hostData` channel is merged one level deep so two slots can
 * each contribute their own `hostData.<key>` without clobbering each other.
 * Keys whose value is `undefined` in `patch` are ignored. With
 * `warnOnOverwrite`, every top-level key (or `hostData` sub-key) that
 * replaces a defined value logs a `console.warn` — a dev aid for spotting
 * two slots that write the same field; `onOverwrite(key)` replaces the
 * logging (the loader uses it to report each collision only once). Always
 * returns a new object.
 */
export function mergeHostData(
  base: HostDataPatch,
  patch: HostDataPatch,
  opts: { warnOnOverwrite?: boolean; onOverwrite?: (key: string) => void } = {},
): HostDataPatch {
  const warn = opts.warnOnOverwrite === true || opts.onOverwrite !== undefined;
  const report = opts.onOverwrite ?? ((key: string) => {
    // eslint-disable-next-line no-console
    console.warn(`tbrowse-core: host data "${key}" overwritten by a later patch`);
  });
  const out: Record<string, unknown> = { ...base };
  const baseRec = base as Record<string, unknown>;
  const patchRec = patch as Record<string, unknown>;
  for (const key of Object.keys(patchRec)) {
    const value = patchRec[key];
    if (value === undefined) continue;
    if (key === 'hostData' && isRecord(value) && isRecord(baseRec['hostData'])) {
      const baseInner = baseRec['hostData'];
      const merged: Record<string, unknown> = { ...baseInner };
      for (const inner of Object.keys(value)) {
        const v = value[inner];
        if (v === undefined) continue;
        if (warn && baseInner[inner] !== undefined) report(`hostData.${inner}`);
        merged[inner] = v;
      }
      out['hostData'] = merged;
      continue;
    }
    if (warn && baseRec[key] !== undefined) report(key);
    out[key] = value;
  }
  return out as HostDataPatch;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Derives per-zone status from per-slot status through the host's
 * zone id → slot ids map. A zone is `'loading'` when any mapped slot is
 * loading, else `'error'` when any mapped slot errored, else `'ready'`
 * when the mapped slots that have started are all ready. Idle (not yet
 * started: lazy, disabled) and undeclared slot ids do not participate, so
 * a zone whose mapped slots are all idle — and a zone with no mapped
 * slots — is absent from the result (`undefined`).
 */
export function zoneStatusOf(
  slots: Record<string, SlotState>,
  zoneSlots: Readonly<Record<string, readonly string[]>>,
): ZoneStatusMap {
  const out: ZoneStatusMap = {};
  for (const zoneId of Object.keys(zoneSlots)) {
    const ids = zoneSlots[zoneId] ?? [];
    let status: ZoneStatus | undefined;
    for (const id of ids) {
      const s = slots[id];
      if (!s || s.status === 'idle') continue;
      if (s.status === 'loading') {
        status = 'loading';
        break;
      }
      if (s.status === 'error') status = 'error';
      else if (status === undefined) status = 'ready';
    }
    if (status !== undefined) out[zoneId] = status;
  }
  return out;
}

/**
 * Turns a snapshot into the props the `TBrowse` viewer takes: `null`
 * until the tree has loaded, else `{ tree, taxonomy?, nodeOfInterest?,
 * zoneStatus }` plus every merged host-data field. Only defined keys are
 * included, so the result spreads straight onto the viewer without
 * tripping `exactOptionalPropertyTypes`.
 */
export function hostPropsFrom<M>(
  s: LoaderSnapshot<M>,
): ({ tree: Tree; taxonomy?: Taxonomy; nodeOfInterest?: string; zoneStatus: ZoneStatusMap } & HostDataPatch) | null {
  if (!s.tree) return null;
  const out: Record<string, unknown> = { tree: s.tree };
  if (s.root?.taxonomy !== undefined) out['taxonomy'] = s.root.taxonomy;
  if (s.root?.nodeOfInterest !== undefined) out['nodeOfInterest'] = s.root.nodeOfInterest;
  out['zoneStatus'] = s.zoneStatus;
  const data = s.data as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    const v = data[key];
    if (v !== undefined) out[key] = v;
  }
  return out as { tree: Tree; taxonomy?: Taxonomy; nodeOfInterest?: string; zoneStatus: ZoneStatusMap } & HostDataPatch;
}

/**
 * Creates a `Loader` for a source. `start(ctx)` aborts any previous
 * generation, loads the root, then runs every enabled eager slot
 * concurrently; `load(slotId)` runs a lazy slot or retries an errored one.
 * The snapshot's `data` is always `root.data` + `toHostData()` of every
 * ready slot merged in slot declaration order, whatever order the slots
 * settled in. `getSnapshot()` returns the same reference until a field
 * actually changes; `subscribe` returns an unsubscribe. `abort()` cancels
 * in-flight work (in-flight slots become `'error'` / `'aborted'`) and
 * `dispose()` drops every listener first, then aborts, so nothing is
 * notified after disposal.
 */
export function createLoader<Ctx, M>(
  source: TreeDataSource<Ctx, M>,
  options: LoaderOptions = {},
): Loader<Ctx, M> {
  const fetch = withRetry(options.fetch ?? defaultFetch, options.retry);
  const zoneSlots = options.zoneSlots ?? {};
  const warnOnOverwrite = options.warnOnOverwrite === true;
  const slotById = new Map<string, DataSlot<unknown, Ctx, M>>();
  for (const slot of source.slots) slotById.set(slot.id, slot);

  const idleSlots = (): Record<string, SlotState> => {
    const out: Record<string, SlotState> = {};
    for (const slot of source.slots) out[slot.id] = IDLE;
    return out;
  };

  let snapshot: LoaderSnapshot<M> = {
    status: 'idle',
    error: null,
    tree: null,
    root: null,
    data: {},
    slots: idleSlots(),
    zoneStatus: {},
    pivot: null,
    generation: 0,
  };
  const listeners = new Set<() => void>();
  /** Bumped by `start()` AND `abort()`; results tagged with an older epoch are dropped. */
  let epoch = 0;
  let controller: AbortController | null = null;
  let ctxCurrent!: Ctx;
  /** (slotId, key) pairs already reported by the overwrite dev aid, so a re-merge does not repeat them. */
  const warned = new Set<string>();
  let root: RootResult<M> | null = null;
  /** `toHostData()` of each ready slot, keyed by slot id. */
  const patches = new Map<string, HostDataPatch>();

  const signalFor = (): AbortSignal => {
    if (!controller || controller.signal.aborted) controller = new AbortController();
    return controller.signal;
  };

  const commit = (next: Partial<LoaderSnapshot<M>>): void => {
    let changed = false;
    for (const key of Object.keys(next) as (keyof LoaderSnapshot<M>)[]) {
      if (snapshot[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  };

  const keepZoneStatus = (next: ZoneStatusMap): ZoneStatusMap =>
    shallowEqualRecord(snapshot.zoneStatus, next) ? snapshot.zoneStatus : next;

  /** Recomputes `data` from `root.data` + ready-slot patches in declaration order. */
  const recomputeData = (): HostDataPatch => {
    let data: HostDataPatch = { ...(root?.data ?? {}) };
    for (const slot of source.slots) {
      const patch = patches.get(slot.id);
      if (!patch) continue;
      // Report each (slot, key) collision once, whatever order the slots settled in.
      data = warnOnOverwrite
        ? mergeHostData(data, patch, {
            onOverwrite: (key) => {
              const tag = `${slot.id}:${key}`;
              if (warned.has(tag)) return;
              warned.add(tag);
              // eslint-disable-next-line no-console
              console.warn(`tbrowse-core: host data "${key}" overwritten by a later patch`);
            },
          })
        : mergeHostData(data, patch);
    }
    return shallowEqualRecord(snapshot.data, data) ? snapshot.data : data;
  };

  const setSlot = (id: string, state: SlotState, extra: Partial<LoaderSnapshot<M>> = {}): void => {
    const slots = { ...snapshot.slots, [id]: state };
    commit({ ...extra, slots, zoneStatus: keepZoneStatus(zoneStatusOf(slots, zoneSlots)) });
  };

  const runSlot = async (slot: DataSlot<unknown, Ctx, M>, myEpoch: number): Promise<void> => {
    const currentRoot = root;
    if (!currentRoot) return;
    const id = slot.id;
    patches.delete(id);
    setSlot(id, { ...IDLE, status: 'loading' }, { data: recomputeData() });
    const onProgress = (p: FanOutProgress): void => {
      if (myEpoch !== epoch) return;
      const cur = snapshot.slots[id];
      if (!cur || cur.status !== 'loading' || sameProgress(cur.progress, p)) return;
      setSlot(id, { ...cur, progress: { done: p.done, total: p.total, failed: p.failed } });
    };
    const signal = signalFor();
    let value: unknown;
    try {
      value = await raceAbort(
        slot.run({
          ctx: ctxCurrent,
          fetch,
          signal,
          tree: currentRoot.tree,
          root: currentRoot,
          onProgress,
          ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        }),
        signal,
      );
    } catch (err) {
      if (myEpoch !== epoch) return;
      setSlot(id, { ...IDLE, status: 'error', error: errorMessage(err) });
      return;
    }
    if (myEpoch !== epoch) return;
    // The post-run hooks are host code too: a throw there is the slot's
    // error, never a rejection of start()/load() or a slot stuck 'loading'.
    try {
      const rawItemErrors = slot.itemErrorsOf?.(value) ?? null;
      const itemErrors = rawItemErrors && Object.keys(rawItemErrors).length > 0 ? rawItemErrors : null;
      const failure = slot.failWhen?.(value, itemErrors) ?? null;
      if (failure !== null) {
        setSlot(id, { status: 'error', value, error: failure, progress: null, itemErrors });
        return;
      }
      const extra: Partial<LoaderSnapshot<M>> = {};
      if (slot.patchMeta && root) {
        const meta = slot.patchMeta(value, root.meta, root);
        if (meta !== root.meta) {
          root = { ...root, meta };
          extra.root = root;
        }
      }
      patches.set(id, slot.toHostData(value, root ?? currentRoot));
      extra.data = recomputeData();
      setSlot(id, { status: 'ready', value, error: null, progress: null, itemErrors }, extra);
    } catch (err) {
      if (myEpoch !== epoch) return;
      patches.delete(id);
      setSlot(id, { ...IDLE, status: 'error', error: errorMessage(err) }, { data: recomputeData() });
    }
  };

  const abortInFlight = (reason: string): void => {
    epoch++;
    if (controller) {
      controller.abort();
      controller = null;
    }
    let slots: Record<string, SlotState> | null = null;
    for (const id of Object.keys(snapshot.slots)) {
      const s = snapshot.slots[id];
      if (!s || s.status !== 'loading') continue;
      slots ??= { ...snapshot.slots };
      slots[id] = { ...IDLE, status: 'error', error: reason };
    }
    const extra: Partial<LoaderSnapshot<M>> =
      snapshot.status === 'loading' ? { status: 'error', error: reason } : {};
    if (slots) {
      commit({ ...extra, slots, zoneStatus: keepZoneStatus(zoneStatusOf(slots, zoneSlots)) });
    } else {
      commit(extra);
    }
  };

  const loader: Loader<Ctx, M> = {
    source,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(ctx) {
      abortInFlight('aborted');
      const myEpoch = epoch;
      ctxCurrent = ctx;
      root = null;
      patches.clear();
      const signal = signalFor();
      commit({
        status: 'loading',
        error: null,
        tree: null,
        root: null,
        data: {},
        slots: idleSlots(),
        zoneStatus: {},
        pivot: null,
        generation: snapshot.generation + 1,
      });
      let result: RootResult<M>;
      try {
        result = await raceAbort(source.loadRoot({ ctx, fetch, signal }), signal);
      } catch (err) {
        if (myEpoch === epoch) commit({ status: 'error', error: errorMessage(err) });
        return snapshot;
      }
      if (myEpoch !== epoch) return snapshot;
      root = result;
      const pivot =
        result.nodeOfInterest !== undefined ? computePivotState(result.tree, result.nodeOfInterest) : null;
      commit({ status: 'ready', error: null, tree: result.tree, root: result, data: recomputeData(), pivot });
      const eager: DataSlot<unknown, Ctx, M>[] = [];
      for (const slot of source.slots) {
        if (slot.mode === 'lazy') continue;
        try {
          if (slot.enabled?.(ctx, result) === false) continue;
          eager.push(slot);
        } catch (err) {
          // A throwing `enabled` is that slot's error; the others still run.
          setSlot(slot.id, { ...IDLE, status: 'error', error: errorMessage(err) });
        }
      }
      await Promise.all(eager.map((slot) => runSlot(slot, myEpoch)));
      return snapshot;
    },
    async load(slotId) {
      const slot = slotById.get(slotId);
      if (!slot) throw new Error(`tbrowse-core: unknown slot "${slotId}" on source "${source.id}"`);
      if (!root) throw new Error(`tbrowse-core: load("${slotId}") called before the root loaded`);
      if (snapshot.slots[slotId]?.status === 'loading') return;
      await runSlot(slot, epoch);
    },
    abort() {
      abortInFlight('aborted');
    },
    dispose() {
      listeners.clear();
      abortInFlight('aborted');
    },
  };
  return loader;
}
