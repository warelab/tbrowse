/**
 * Helpers for composing `TreeDataSource`s: declare a typed slot, derive a
 * source from another by adding / replacing / removing slots, or wrap a
 * plain `ctx → RootResult` function as a source (what the playground's
 * "toggle tree size" button uses, with `ctx = { size }`).
 */
import type { DataSlot, RootContext, RootResult, TreeDataSource } from './types';

/**
 * Identity helper that pins a slot's `T`, `Ctx` and `M` so the `run` /
 * `toHostData` / `failWhen` members are type-checked against each other
 * without the caller writing the generics twice.
 */
export function defineSlot<T, Ctx, M>(slot: DataSlot<T, Ctx, M>): DataSlot<T, Ctx, M> {
  return slot;
}

/**
 * Derives a new source from `source`: the same `loadRoot`, `id` from the
 * patch (default: the original id), and `slots` = the original slots minus
 * the `without` ids, with each given slot either replacing the existing
 * slot of the same id IN PLACE (keeping declaration order, and hence the
 * host-data merge order) or appended. `Ctx2 extends Ctx` lets the added
 * slots read extra context fields the original source never sees.
 */
export function extendSource<Ctx, M, Ctx2 extends Ctx = Ctx>(
  source: TreeDataSource<Ctx, M>,
  patch: {
    id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    slots?: readonly DataSlot<any, Ctx2, M>[];
    without?: readonly string[];
  },
): TreeDataSource<Ctx2, M> {
  const without = new Set(patch.without ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots: DataSlot<any, Ctx2, M>[] = source.slots.filter((s) => !without.has(s.id));
  for (const slot of patch.slots ?? []) {
    const at = slots.findIndex((s) => s.id === slot.id);
    if (at >= 0) slots[at] = slot;
    else slots.push(slot);
  }
  return {
    id: patch.id ?? source.id,
    ...(source.label !== undefined ? { label: source.label } : {}),
    loadRoot: (rc: RootContext<Ctx2>) => source.loadRoot(rc),
    slots,
  };
}

/**
 * Wraps a function of the context into a `TreeDataSource` whose
 * `loadRoot` awaits `rootOf(ctx)` (sync or async). Handy for in-memory
 * trees, fixtures and tests; the optional `slots` are attached unchanged.
 */
export function staticSource<Ctx, M>(
  rootOf: (ctx: Ctx) => RootResult<M> | Promise<RootResult<M>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slots: readonly DataSlot<any, Ctx, M>[] = [],
): TreeDataSource<Ctx, M> {
  return {
    id: 'static',
    loadRoot: async ({ ctx }) => rootOf(ctx),
    slots,
  };
}
