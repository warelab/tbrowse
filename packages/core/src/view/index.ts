/**
 * `tbrowse-core/view`: headless construction, persistence and layout of the
 * viewer's `ViewState` — initial state from a zone list, soft resets,
 * tolerant deserialisation, URL-hash sharing, control-derived prune layering,
 * and the row model (`computeVisibleRows` / `computeRowRange`).
 */
export {
  EMPTY_VIEW_STATE,
  type InitialViewStateOptions,
  buildInitialViewState,
  applyPivot,
  softResetForNewTree,
  ensureZones,
  normalizeViewState,
  pixelWidthsToFr,
} from './initial';
export {
  encodeHashState,
  decodeHashState,
  readHashState,
  writeHashState,
  isViewStateLike,
} from './hash';
export {
  mergeDerivedPrunes,
  stripDerivedPrunes,
  type DerivedPruneLayer,
  createDerivedPruneLayer,
  stripPrunesForSnapshot,
} from './derivedPrune';
export {
  LEAF_ROW_HEIGHT,
  SUMMARY_ROW_HEIGHT,
  type VisibleRowsInput,
  computeVisibleRows,
  computeRowRange,
} from './visibleRows';
