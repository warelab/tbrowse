import { useEffect, useRef, useState } from 'react';
import type { LabelProvider } from '../../types';

type Entry =
  | { state: 'pending' }
  | { state: 'resolved'; value: string | null }
  | { state: 'rejected' };

export interface ProviderCache {
  /** 'pending' if the fetch is in flight; null on rejection or resolved-null. */
  get(providerId: string, geneId: string): string | null | 'pending';
}

/**
 * Manage async fetches for a set of (providerId, geneId) pairs. Caches
 * resolved values keyed by both. Re-running the effect tears down in-flight
 * fetches for ids that are no longer needed (e.g. tree changed, zone hidden).
 *
 * `geneIds` should be a stable-keyed array — sort or deduplicate upstream so
 * the effect dep doesn't churn on identity-only changes.
 */
export function useProviderCache(
  activeProviders: LabelProvider[],
  geneIds: string[],
): ProviderCache {
  const cacheRef = useRef(new Map<string, Map<string, Entry>>());
  const [, bumpVersion] = useState(0);

  // Stable string key for the effect dep. Without this, every render rebuilds
  // arrays and re-triggers the effect.
  const providerKey = activeProviders.map((p) => p.id).sort().join('|');
  const geneKey = [...new Set(geneIds)].sort().join('|');

  useEffect(() => {
    if (activeProviders.length === 0 || geneIds.length === 0) return;
    const controllers: AbortController[] = [];
    const cache = cacheRef.current;

    for (const p of activeProviders) {
      let m = cache.get(p.id);
      if (!m) {
        m = new Map();
        cache.set(p.id, m);
      }
      const providerCache = m;
      for (const gid of geneIds) {
        if (providerCache.has(gid)) continue;
        providerCache.set(gid, { state: 'pending' });
        const ctrl = new AbortController();
        controllers.push(ctrl);
        p.fetch(gid, ctrl.signal)
          .then((value) => {
            if (ctrl.signal.aborted) return;
            providerCache.set(gid, { state: 'resolved', value });
            bumpVersion((v) => v + 1);
          })
          .catch((err: unknown) => {
            if (ctrl.signal.aborted) return;
            const name = (err as { name?: string } | null)?.name;
            if (name === 'AbortError') return;
            providerCache.set(gid, { state: 'rejected' });
            bumpVersion((v) => v + 1);
          });
      }
    }

    return () => {
      // Cancel any still-pending fetches kicked off by this effect run.
      for (const c of controllers) c.abort();
      // Drop pending entries so a future render can retry them.
      for (const p of activeProviders) {
        const m = cacheRef.current.get(p.id);
        if (!m) continue;
        for (const gid of geneIds) {
          if (m.get(gid)?.state === 'pending') m.delete(gid);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey, geneKey]);

  return {
    get(providerId, geneId) {
      const entry = cacheRef.current.get(providerId)?.get(geneId);
      if (!entry) return 'pending';
      if (entry.state === 'pending') return 'pending';
      if (entry.state === 'rejected') return null;
      return entry.value;
    },
  };
}
