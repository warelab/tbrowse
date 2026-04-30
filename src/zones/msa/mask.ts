import type { GeneId, MSA } from '../../types';

export interface MSAMask {
  /** Original-column index of the i-th visible column. */
  visibleCols: number[];
  /** Runs of original columns hidden by the mask, in column order. */
  hiddenRuns: { start: number; end: number; visibleAt: number }[];
}

const EMPTY_MASK: MSAMask = { visibleCols: [], hiddenRuns: [] };

/**
 * Build a column mask: drop columns whose non-gap *count* (across active
 * leaves) falls below `minCoverage`, then dilate the surviving "covered"
 * mask by `padding` columns on each side so brief drops don't break a
 * contiguous region.
 *
 * `minCoverage` is an integer count — covered iff `nonGapCount >= minCoverage`.
 * `minCoverage = 0` keeps every column (no masking by coverage).
 *
 * `activeGeneIds` is the set of leaves contributing to coverage — typically
 * all leaves with sequences minus those under any pruned ancestor.
 */
export function computeMSAMask(
  msa: MSA,
  activeGeneIds: ReadonlySet<GeneId>,
  minCoverage: number,
  padding: number,
): MSAMask {
  if (msa.length === 0) return EMPTY_MASK;
  if (minCoverage <= 0) {
    // No coverage threshold → every column visible, no hidden runs.
    return unmaskedMSA(msa);
  }

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

  // Dilate by `padding` (column is kept if any column within ±padding is rawCovered).
  const covered = new Array<boolean>(msa.length).fill(false);
  if (padding === 0) {
    for (let c = 0; c < msa.length; c++) covered[c] = rawCovered[c];
  } else {
    let lastCoveredAt = -Infinity;
    for (let c = 0; c < msa.length; c++) {
      if (rawCovered[c]) lastCoveredAt = c;
      if (c - lastCoveredAt <= padding) covered[c] = true;
    }
    // Look-ahead pass to expand right side too.
    let nextCoveredAt = Infinity;
    for (let c = msa.length - 1; c >= 0; c--) {
      if (rawCovered[c]) nextCoveredAt = c;
      if (nextCoveredAt - c <= padding) covered[c] = true;
    }
  }

  const visibleCols: number[] = [];
  const hiddenRuns: { start: number; end: number; visibleAt: number }[] = [];
  let runStart = -1;
  for (let c = 0; c < msa.length; c++) {
    if (covered[c]) {
      if (runStart >= 0) {
        hiddenRuns.push({ start: runStart, end: c - 1, visibleAt: visibleCols.length });
        runStart = -1;
      }
      visibleCols.push(c);
    } else {
      if (runStart < 0) runStart = c;
    }
  }
  if (runStart >= 0) {
    hiddenRuns.push({ start: runStart, end: msa.length - 1, visibleAt: visibleCols.length });
  }
  return { visibleCols, hiddenRuns };
}

/** Used when no mask is desired — all columns visible, no runs. */
export function unmaskedMSA(msa: MSA): MSAMask {
  const visibleCols = new Array<number>(msa.length);
  for (let i = 0; i < msa.length; i++) visibleCols[i] = i;
  return { visibleCols, hiddenRuns: [] };
}
