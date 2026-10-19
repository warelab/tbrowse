import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeHashState,
  encodeHashState,
  isViewStateLike,
  readHashState,
  writeHashState,
} from './hash';
import { EMPTY_VIEW_STATE } from './initial';

type Mutable = Record<string, unknown>;
const g = globalThis as Mutable;

/** Install fake `location` / `history` on globalThis; returns the mocks. */
function installBrowser(hash = '', pathname = '/app', search = '?q=1') {
  const history = { replaceState: vi.fn(), pushState: vi.fn() };
  g['location'] = { hash, pathname, search };
  g['history'] = history;
  return history;
}

function uninstallBrowser() {
  delete g['location'];
  delete g['history'];
}

afterEach(uninstallBrowser);

describe('encodeHashState / decodeHashState', () => {
  it('round-trips a view state', () => {
    const state = { ...EMPTY_VIEW_STATE, collapsedNodeIds: ['n1'], search: { query: 'a b&c' } };
    const hash = encodeHashState(state);
    expect(hash.startsWith('#')).toBe(true);
    expect(hash).not.toContain(' ');
    expect(decodeHashState(hash)).toEqual(state);
  });

  it('decodes with or without the leading #', () => {
    const hash = encodeHashState({ source: 'sample' });
    expect(decodeHashState(hash)).toEqual({ source: 'sample' });
    expect(decodeHashState(hash.slice(1))).toEqual({ source: 'sample' });
  });

  it('returns null for an empty hash', () => {
    expect(decodeHashState('')).toBeNull();
    expect(decodeHashState('#')).toBeNull();
  });

  it('returns null for malformed JSON or percent-encoding', () => {
    expect(decodeHashState('#%7Bnot-json')).toBeNull();
    expect(decodeHashState('#%E0%A4%A')).toBeNull();
    expect(decodeHashState('#section-anchor')).toBeNull();
  });

  it('returns null for a non-object payload', () => {
    expect(decodeHashState(encodeHashState(42))).toBeNull();
    expect(decodeHashState(encodeHashState('str'))).toBeNull();
    expect(decodeHashState(encodeHashState(null))).toBeNull();
  });

  it('runs the guard and returns null when it rejects', () => {
    const isSource = (v: unknown): v is { source: string } =>
      typeof v === 'object' && v !== null && typeof (v as Mutable)['source'] === 'string';
    expect(decodeHashState(encodeHashState({ source: 'x' }), isSource)).toEqual({ source: 'x' });
    expect(decodeHashState(encodeHashState({ other: 1 }), isSource)).toBeNull();
  });
});

describe('readHashState / writeHashState under Node (no location)', () => {
  it('readHashState returns null', () => {
    expect(g['location']).toBeUndefined();
    expect(readHashState()).toBeNull();
  });

  it('writeHashState is a no-op and does not throw', () => {
    expect(() => writeHashState({ a: 1 })).not.toThrow();
    expect(() => writeHashState({ a: 1 }, 'push')).not.toThrow();
  });
});

describe('readHashState / writeHashState with browser-like globals', () => {
  it('readHashState decodes location.hash', () => {
    installBrowser(encodeHashState({ source: 'gramene' }));
    expect(readHashState()).toEqual({ source: 'gramene' });
  });

  it('readHashState applies the guard', () => {
    installBrowser(encodeHashState({ source: 'gramene' }));
    const never = (_v: unknown): _v is never => false;
    expect(readHashState(never)).toBeNull();
  });

  it('writeHashState calls replaceState with pathname + search + hash by default', () => {
    const history = installBrowser('');
    writeHashState({ a: 1 });
    expect(history.replaceState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/app?q=1' + encodeHashState({ a: 1 }));
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('writeHashState uses pushState in push mode', () => {
    const history = installBrowser('');
    writeHashState({ a: 1 }, 'push');
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('writeHashState skips the write when the hash already matches', () => {
    const history = installBrowser(encodeHashState({ a: 1 }));
    writeHashState({ a: 1 });
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(history.pushState).not.toHaveBeenCalled();
  });

  it('writeHashState tolerates a location without pathname/search', () => {
    const history = { replaceState: vi.fn(), pushState: vi.fn() };
    g['location'] = { hash: '' };
    g['history'] = history;
    writeHashState({ a: 1 });
    expect(history.replaceState).toHaveBeenCalledWith(null, '', encodeHashState({ a: 1 }));
  });
});

describe('isViewStateLike', () => {
  it('accepts objects, partial or full', () => {
    expect(isViewStateLike({})).toBe(true);
    expect(isViewStateLike({ collapsedNodeIds: ['a'] })).toBe(true);
    expect(isViewStateLike({ ...EMPTY_VIEW_STATE })).toBe(true);
    expect(isViewStateLike({ search: null })).toBe(true);
    expect(isViewStateLike({ search: { query: 'x' } })).toBe(true);
  });

  it('rejects non-objects and arrays', () => {
    expect(isViewStateLike(null)).toBe(false);
    expect(isViewStateLike(undefined)).toBe(false);
    expect(isViewStateLike(1)).toBe(false);
    expect(isViewStateLike('s')).toBe(false);
    expect(isViewStateLike([])).toBe(false);
  });

  it('rejects wrongly-typed containers', () => {
    expect(isViewStateLike({ collapsedNodeIds: 'a' })).toBe(false);
    expect(isViewStateLike({ zones: {} })).toBe(false);
    expect(isViewStateLike({ zoneStates: [] })).toBe(false);
    expect(isViewStateLike({ zoneStates: 'x' })).toBe(false);
    expect(isViewStateLike({ search: 'x' })).toBe(false);
    expect(isViewStateLike({ search: {} })).toBe(false);
  });
});
