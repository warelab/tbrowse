import type { GeneId, MSA } from '../../types';

export interface MaskedRun {
  /** Original-column start (inclusive). */
  start: number;
  /** Original-column end (inclusive). */
  end: number;
  /** Index in `visibleCols` where this run sits. For an expanded run this is
   *  the index of the run's first column. For a collapsed run this is the
   *  index where its first column WOULD have been (i.e. between adjacent
   *  visible cols). */
  visibleAt: number;
  /** True when the user has explicitly opened this run; its columns are
   *  included in visibleCols. */
  expanded: boolean;
}

export interface MSAMask {
  /** Original-column index of the i-th visible column. */
  visibleCols: number[];
  /** All masked runs (collapsed + expanded), in column order. */
  runs: MaskedRun[];
}

const EMPTY_MASK: MSAMask = { visibleCols: [], runs: [] };

/**
 * Build a column mask: drop columns whose non-gap *count* (across active
 * leaves) falls below `minCoverage`, then dilate the surviving "covered"
 * mask by `padding` columns on each side so brief drops don't break a
 * contiguous region.
 *
 * `minCoverage` is an integer count — covered iff `nonGapCount >= minCoverage`.
 * `minCoverage <= 0` keeps every column (no masking by coverage).
 *
 * `expandedRunStarts` lets the user override the mask for individual runs:
 * a run whose start column is in this set has its columns re-injected into
 * visibleCols and is reported with `expanded: true` so the renderer can show
 * a different marker for it.
 */
export function computeMSAMask(
  msa: MSA,
  activeGeneIds: ReadonlySet<GeneId>,
  minCoverage: number,
  padding: number,
  expandedRunStarts: ReadonlySet<number> = new Set(),
): MSAMask {
  if (msa.length === 0) return EMPTY_MASK;
  if (minCoverage <= 0) return unmaskedMSA(msa);

  const rawCovered = new Array<boolean>(msa.length).fill(false);
  const idsArr = [...activeGeneIds];
  for (let c = 0; c < msa.length; c++) {
    let nonGap = 0;
    for (const id of idsArr) {
      const ch = msa.sequences[id]?.[c];
      if (ch && ch !== '-') nonGap++;
    }
    if (nonGap >= minCoverage) rawCovered[c] = true;
  }

  // Dilate by `padding` (column kept if any column within ±padding is rawCovered).
  const covered = new Array<boolean>(msa.length).fill(false);
  if (padding === 0) {
    for (let c = 0; c < msa.length; c++) covered[c] = rawCovered[c];
  } else {
    let lastCoveredAt = -Infinity;
    for (let c = 0; c < msa.length; c++) {
      if (rawCovered[c]) lastCoveredAt = c;
      if (c - lastCoveredAt <= padding) covered[c] = true;
    }
    let nextCoveredAt = Infinity;
    for (let c = msa.length - 1; c >= 0; c--) {
      if (rawCovered[c]) nextCoveredAt = c;
      if (nextCoveredAt - c <= padding) covered[c] = true;
    }
  }

  const visibleCols: number[] = [];
  const runs: MaskedRun[] = [];
  let runStart = -1;
  for (let c = 0; c < msa.length; c++) {
    if (covered[c]) {
      if (runStart >= 0) {
        const expanded = expandedRunStarts.has(runStart);
        const visibleAtBeforeExpand = visibleCols.length;
        if (expanded) {
          for (let k = runStart; k < c; k++) visibleCols.push(k);
        }
        runs.push({
          start: runStart,
          end: c - 1,
          visibleAt: visibleAtBeforeExpand,
          expanded,
        });
        runStart = -1;
      }
      visibleCols.push(c);
    } else {
      if (runStart < 0) runStart = c;
    }
  }
  if (runStart >= 0) {
    const expanded = expandedRunStarts.has(runStart);
    const visibleAtBeforeExpand = visibleCols.length;
    if (expanded) {
      for (let k = runStart; k < msa.length; k++) visibleCols.push(k);
    }
    runs.push({
      start: runStart,
      end: msa.length - 1,
      visibleAt: visibleAtBeforeExpand,
      expanded,
    });
  }
  return { visibleCols, runs };
}

/** Used when no mask is desired — all columns visible, no runs. */
export function unmaskedMSA(msa: MSA): MSAMask {
  const visibleCols = new Array<number>(msa.length);
  for (let i = 0; i < msa.length; i++) visibleCols[i] = i;
  return { visibleCols, runs: [] };
}
