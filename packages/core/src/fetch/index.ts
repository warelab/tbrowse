/**
 * `tbrowse-core/fetch`: a retrying, injectable `fetch`, JSON + URL
 * helpers, and bounded-concurrency fan-outs with per-key failure
 * accounting. Everything here is transport-only; it knows nothing about
 * trees or zones and has no DOM dependency.
 */
export {
  type FetchLike,
  RETRYABLE_STATUS,
  type RetryOptions,
  backoffMs,
  fetchWithRetry,
  withRetry,
  defaultFetch,
} from './retry';
export { HttpError, getJson, buildUrl, splitUrl, type UrlParamValue } from './json';
export {
  type FanOutProgress,
  type FanOutOptions,
  type FanOutResult,
  fanOut,
  chunk,
  fanOutChunks,
  mergeRecords,
} from './fanOut';
