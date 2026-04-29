import type { MSA } from '../../types';

/**
 * For each column, the fraction of leaf sequences with a non-gap residue.
 * Used by the minimap to convey alignment density at a glance.
 */
export function computeColumnCoverage(msa: MSA): Float32Array {
  const result = new Float32Array(msa.length);
  const ids = Object.keys(msa.sequences);
  if (ids.length === 0) return result;
  const denom = ids.length;
  for (let c = 0; c < msa.length; c++) {
    let count = 0;
    for (const id of ids) {
      const ch = msa.sequences[id][c];
      if (ch && ch !== '-') count++;
    }
    result[c] = count / denom;
  }
  return result;
}
