import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  createLoader,
  hostPropsFrom,
  type Loader,
  type LoaderOptions,
  type LoaderSnapshot,
  type TreeDataSource,
} from 'tbrowse-core';

export interface UseLoaderOptions extends LoaderOptions {
  /**
   * Restart identity. The loader restarts (aborting the previous run)
   * whenever this changes; default is the `ctx` object reference
   * (`Object.is`), so memoize `ctx` or pass a cheap key. Never
   * `JSON.stringify` a ctx: a `File` stringifies to `{}` and a Gramene
   * `rawGenetree` is a whole genetree document.
   */
  key?: string | number | readonly unknown[];
}

export interface UseLoaderResult<Ctx, M> {
  snapshot: LoaderSnapshot<M>;
  loader: Loader<Ctx, M>;
  /** `hostPropsFrom(snapshot)`: spread onto `<TBrowse>` once non-null. */
  hostProps: ReturnType<typeof hostPropsFrom<M>>;
}

const keyOf = (key: UseLoaderOptions['key']): string =>
  Array.isArray(key) ? key.map((k) => String(k)).join('\u0000') : String(key);

/**
 * Run a tbrowse-core `TreeDataSource` from a React component. One `Loader`
 * is created per `source` (disposed on unmount or when the source changes);
 * `start(ctx)` runs whenever the restart key changes (see `key`); the
 * snapshot is read through `useSyncExternalStore`, so renders only happen
 * when the loader actually changed something. Pass `ctx: null` to hold the
 * loader idle (nothing is started; an in-flight run is aborted).
 *
 * ```tsx
 * const { hostProps, snapshot, loader } = useLoader(ensemblGeneTreeSource, ctx, {
 *   zoneSlots: { msa: ['proteinDomains'], 'genome-canonical': ['overlap'] },
 * });
 * if (!hostProps) return snapshot.error ? <Error msg={snapshot.error} /> : <Spinner />;
 * return <TBrowse {...hostProps} zones={zones} viewState={vs} onViewStateChange={setVs} />;
 * ```
 */
export function useLoader<Ctx, M = Record<string, unknown>>(
  source: TreeDataSource<Ctx, M>,
  ctx: Ctx | null,
  options: UseLoaderOptions = {},
): UseLoaderResult<Ctx, M> {
  const { key, ...loaderOptions } = options;
  // The loader options are captured at creation; hosts that need to change
  // zoneSlots at runtime should pass a new source identity.
  const optionsRef = useRef(loaderOptions);
  optionsRef.current = loaderOptions;
  const loader = useMemo(() => createLoader(source, optionsRef.current), [source]);
  useEffect(() => () => loader.dispose(), [loader]);

  const snapshot = useSyncExternalStore(loader.subscribe, loader.getSnapshot, loader.getSnapshot);

  // Nullness is part of the restart identity, so `ctx: null` aborts even
  // when the host keeps passing the same explicit `key`.
  const restartKey = ctx === null ? null : key === undefined ? ctx : keyOf(key);
  useEffect(() => {
    if (ctx === null) {
      loader.abort();
      return;
    }
    void loader.start(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, restartKey]);

  const hostProps = useMemo(() => hostPropsFrom(snapshot), [snapshot]);
  return { snapshot, loader, hostProps };
}
