import type { Tree, Taxonomy, HostDataPatch, ZoneStatusMap } from '../types';
import type { PivotState } from '../tree/pivot';
import type { FetchLike, RetryOptions } from '../fetch/retry';
import type { FanOutProgress } from '../fetch/fanOut';

/**
 * The data-source contract: a `TreeDataSource` loads a root (the tree and
 * whatever arrived with it) and declares `DataSlot`s — independently
 * fetched per-leaf data that becomes `HostData` fields. A `Loader` runs a
 * source and exposes a snapshot (tree, merged host data, per-slot status,
 * per-zone status) that a React host can subscribe to with
 * `useSyncExternalStore`, or a script can simply `await`.
 *
 * Slots carry NO zone ids: zone ids are host-assigned (`createGenomeZone({ id })`,
 * `createGenotypeMatrixZone({ id })`), so the host maps zone id → slot ids
 * through `LoaderOptions.zoneSlots`.
 */

export type SlotStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SlotState<T = unknown> {
  status: SlotStatus;
  value: T | undefined;
  error: string | null;
  /** Live during fan-outs. */
  progress: FanOutProgress | null;
  /** Per-leaf failures: the slot is 'ready' with partial data. */
  itemErrors: Record<string, string> | null;
}

/** What a source's root load yields: the tree plus whatever arrived with it. `M` = source-specific metadata, typed. */
export interface RootResult<M = Record<string, unknown>> {
  tree: Tree;
  taxonomy?: Taxonomy;
  /** Gene id or node id; fed to `computePivotState`. */
  nodeOfInterest?: string;
  /** msa, geneMetadata, proteinDomains, … that came with the tree. */
  data?: HostDataPatch;
  /** e.g. `{ proteinIdByGeneId }`, `{ treeId }`, `{ matrix, swappedNodeIds }`. */
  meta: M;
}

export interface RootContext<Ctx> {
  ctx: Ctx;
  /** Already retry-wrapped. */
  fetch: FetchLike;
  signal: AbortSignal;
}

export interface SlotContext<Ctx, M> extends RootContext<Ctx> {
  tree: Tree;
  root: RootResult<M>;
  onProgress: (p: FanOutProgress) => void;
  /** `LoaderOptions.concurrency`, for slots that fan out per leaf. */
  concurrency?: number;
}

export interface DataSlot<T, Ctx = unknown, M = Record<string, unknown>> {
  id: string;
  /** Default 'eager' = runs right after the root. */
  mode?: 'eager' | 'lazy';
  enabled?: (ctx: Ctx, root: RootResult<M>) => boolean;
  run(sc: SlotContext<Ctx, M>): Promise<T>;
  toHostData(value: T, root: RootResult<M>): HostDataPatch;
  /** Optional: expose per-item failures (fanOut errors) so the loader records them without failing the slot. */
  itemErrorsOf?(value: T): Record<string, string> | null;
  /** Optional: turn a resolved value into a slot error (e.g. "all N requests failed"); returning null keeps 'ready'. */
  failWhen?(value: T, itemErrors: Record<string, string> | null): string | null;
  /** Optional: update root metadata (e.g. merge variant sites into meta.matrix). Must return a NEW object when anything changed; the loader then replaces snapshot.root. */
  patchMeta?(value: T, meta: M, root: RootResult<M>): M;
}

export interface TreeDataSource<Ctx = unknown, M = Record<string, unknown>> {
  id: string;
  label?: string;
  loadRoot(rc: RootContext<Ctx>): Promise<RootResult<M>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slots: readonly DataSlot<any, Ctx, M>[];
}

export interface LoaderSnapshot<M = Record<string, unknown>> {
  /** Status of the root load. */
  status: SlotStatus;
  error: string | null;
  tree: Tree | null;
  /** Replaced (new reference) when a slot's `patchMeta` returns a new meta. */
  root: RootResult<M> | null;
  /** `root.data` + `toHostData()` of every ready slot, merged in slot order. */
  data: HostDataPatch;
  slots: Record<string, SlotState>;
  /** `zoneStatusOf(slots, options.zoneSlots)`. */
  zoneStatus: ZoneStatusMap;
  /** `computePivotState(tree, root.nodeOfInterest)`. */
  pivot: PivotState | null;
  /** Bumps on every `start()`; stale async results are dropped. */
  generation: number;
}

export interface LoaderOptions {
  fetch?: FetchLike;
  retry?: RetryOptions;
  concurrency?: number;
  /** Host zone id → slot ids that feed it. */
  zoneSlots?: Readonly<Record<string, readonly string[]>>;
  /** Dev aid: warn when two slots write the same top-level key. */
  warnOnOverwrite?: boolean;
}

export interface Loader<Ctx = unknown, M = Record<string, unknown>> {
  readonly source: TreeDataSource<Ctx, M>;
  /** Same reference until something changes (useSyncExternalStore-safe). */
  getSnapshot(): LoaderSnapshot<M>;
  subscribe(listener: () => void): () => void;
  /** Aborts the previous generation; loads the root, then the enabled eager slots. */
  start(ctx: Ctx): Promise<LoaderSnapshot<M>>;
  /** Lazy slots, or retry an errored one. */
  load(slotId: string): Promise<void>;
  abort(): void;
  dispose(): void;
}
