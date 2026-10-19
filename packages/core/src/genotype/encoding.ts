import type { GenotypeMatrix } from '../types';

export const DEFAULT_SEP_PHASED = '|';
export const DEFAULT_SEP_UNPHASED = '/';
export const DEFAULT_UNKNOWN = '.';

/** Decoded genotype call. `alleles` is the per-allele integer index
 *  (0 = REF, 1+ = ALT[i-1]); a missing allele is -1. */
export interface DecodedCall {
  alleles: number[];
  phased: boolean;
  /** Number of non-REF, non-missing allele copies (capped at the call's
   *  ploidy, typically 2). The zone uses this as the heatmap axis. */
  altDosage: number;
  /** True when at least one allele is missing. */
  missing: boolean;
}

/** Decode one genotype call string. Empty input yields a fully-missing
 *  diploid call so callers don't have to special-case absent rows. */
export function decodeCall(
  raw: string | undefined,
  sepPhased = DEFAULT_SEP_PHASED,
  sepUnphased = DEFAULT_SEP_UNPHASED,
  unknown = DEFAULT_UNKNOWN,
): DecodedCall {
  if (!raw || raw.length === 0) {
    return { alleles: [-1, -1], phased: false, altDosage: 0, missing: true };
  }
  const phased = raw.indexOf(sepPhased) >= 0;
  const sep = phased ? sepPhased : sepUnphased;
  const parts = raw.split(sep);
  const alleles: number[] = [];
  let missing = false;
  let altDosage = 0;
  for (const p of parts) {
    if (p === unknown || p === '') {
      alleles.push(-1);
      missing = true;
      continue;
    }
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0) {
      alleles.push(-1);
      missing = true;
      continue;
    }
    alleles.push(n);
    if (n > 0) altDosage++;
  }
  return { alleles, phased, altDosage, missing };
}

/** Cell color for a decoded call, on a 0-1-2 dosage scale. Missing
 *  calls render in a neutral gray; everything else maps onto a
 *  white→blue gradient that matches the existing accent-light palette. */
export function colorForCall(call: DecodedCall): string {
  if (call.missing && call.altDosage === 0) return '#e3e3e3';
  if (call.altDosage === 0) return '#f5f7fa'; // homozygous REF
  if (call.altDosage === 1) return '#7fa8d8'; // heterozygous
  return '#284b80'; // homozygous ALT (or compound het)
}

/** Average dosage across a set of leaves at one variant — used for
 *  the consensus row beneath a collapsed clade. Returns null when
 *  every contributor is missing. */
export function averageDosage(
  matrix: GenotypeMatrix,
  geneIds: readonly string[],
  variantIdx: number,
  sepPhased = matrix.sepPhased ?? DEFAULT_SEP_PHASED,
  sepUnphased = matrix.sepUnphased ?? DEFAULT_SEP_UNPHASED,
  unknown = matrix.unknownString ?? DEFAULT_UNKNOWN,
): number | null {
  let total = 0;
  let n = 0;
  for (const id of geneIds) {
    const row = matrix.callsByGeneId[id];
    if (!row) continue;
    const call = decodeCall(row[variantIdx], sepPhased, sepUnphased, unknown);
    if (call.missing && call.altDosage === 0) continue;
    total += call.altDosage;
    n++;
  }
  if (n === 0) return null;
  return total / n;
}

/** Color a continuous dosage value (0..2) using the same gradient as
 *  `colorForCall` but with smooth interpolation. */
export function colorForAverageDosage(d: number): string {
  if (d <= 1) {
    const t = d;
    return mix('#f5f7fa', '#7fa8d8', t);
  }
  const t = d - 1;
  return mix('#7fa8d8', '#284b80', t);
}

function mix(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}
