/**
 * URL-hash codec for sharing view state: `#<percent-encoded JSON>`. The
 * encoder and decoder are pure; the read/write helpers reach the browser's
 * `location` and `history` through `globalThis` only, so this module compiles
 * without the DOM lib and is a no-op under Node.
 *
 * Origin: `tbrowse/examples/playground/main.tsx:232-248` (encode/decode) and
 * `:905-925` (the `replaceState` mirror effect). The playground's `UrlState`
 * shape is its own; this codec is generic over the payload.
 */
import type { ViewState } from '../types';

/**
 * The slice of the browser globals this module touches, declared
 * structurally so no DOM typings are needed. Absent fields mean "not a
 * browser" (Node, workers without `location`).
 */
type BrowserGlobals = {
  location?: { hash: string; pathname?: string; search?: string };
  history?: {
    replaceState(state: unknown, title: string, url: string): void;
    pushState(state: unknown, title: string, url: string): void;
  };
};

/**
 * Serialise any JSON-able value as a URL hash: `'#' + encodeURIComponent(JSON.stringify(state))`.
 * Origin: `main.tsx:246-248` (`encodeUrlState`).
 */
export function encodeHashState(state: unknown): string {
  return '#' + encodeURIComponent(JSON.stringify(state));
}

/**
 * Inverse of {@link encodeHashState}. Accepts the hash with or without its
 * leading `#`. Returns `null` for an empty hash, malformed percent-encoding
 * or JSON, a non-object payload, or a payload the optional type `guard`
 * rejects — never throws, so a bad shared link lands on a fresh view.
 * Origin: `main.tsx:232-244` (`decodeUrlState`).
 */
export function decodeHashState<T>(hash: string, guard?: (v: unknown) => v is T): T | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (guard && !guard(parsed)) return null;
  return parsed as T;
}

/**
 * Decode the current page's `location.hash` with {@link decodeHashState}.
 * Returns `null` when there is no `location` on `globalThis` (Node).
 */
export function readHashState<T>(guard?: (v: unknown) => v is T): T | null {
  const g = globalThis as BrowserGlobals;
  if (!g.location) return null;
  return decodeHashState<T>(g.location.hash, guard);
}

/**
 * Mirror `state` into the page's URL hash via `history.replaceState`
 * (default, keeps the back button uncluttered) or `history.pushState`.
 * Skips the write when the hash already equals the encoding, and does
 * nothing when `globalThis` has no `location` or `history` (Node).
 * Origin: `main.tsx:905-925`.
 */
export function writeHashState(state: unknown, mode: 'replace' | 'push' = 'replace'): void {
  const g = globalThis as BrowserGlobals;
  if (!g.location || !g.history) return;
  const next = encodeHashState(state);
  if (g.location.hash === next) return;
  const url = (g.location.pathname ?? '') + (g.location.search ?? '') + next;
  if (mode === 'push') g.history.pushState(null, '', url);
  else g.history.replaceState(null, '', url);
}

/**
 * Loose structural check suitable as a `decodeHashState` guard: `v` is a
 * non-array object and every `ViewState` field that is present has the right
 * container type (id lists and `zones` are arrays, `zoneStates` is an object,
 * `search` is `null` or an object with a string `query`). Fields may be
 * missing — pass the result through `normalizeViewState` to fill them.
 */
export function isViewStateLike(v: unknown): v is Partial<ViewState> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const key of [
    'collapsedNodeIds',
    'prunedNodeIds',
    'swappedNodeIds',
    'compressedNodeIds',
    'zones',
    'unlinkedZoneGroups',
  ]) {
    if (key in o && o[key] !== undefined && !Array.isArray(o[key])) return false;
  }
  if ('zoneStates' in o && o['zoneStates'] !== undefined) {
    const zs = o['zoneStates'];
    if (typeof zs !== 'object' || zs === null || Array.isArray(zs)) return false;
  }
  if ('search' in o && o['search'] !== undefined && o['search'] !== null) {
    const s = o['search'];
    if (typeof s !== 'object' || typeof (s as Record<string, unknown>)['query'] !== 'string') {
      return false;
    }
  }
  return true;
}
