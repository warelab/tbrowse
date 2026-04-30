import type { GeneId, MSA, ProteinDomain } from '../../types';

/**
 * For an aligned sequence (with `-` or `.` gap characters), build a lookup
 * from 1-based unaligned residue index → 0-based MSA column. Returns an
 * array `colByResidue` such that:
 *   colByResidue[residueIdx] = MSA column that holds that residue
 * for residueIdx in 1..N where N is the count of non-gap chars.
 *
 * `colByResidue[0]` is unused (residue indices are 1-based).
 *
 * Used to map ProteinDomain.start/end (residue positions) onto the MSA
 * column space so the rendering code can size domain bars from a column
 * range without knowing about gaps.
 */
export function buildResidueToColumn(alignedSeq: string): number[] {
  const out: number[] = [0];
  for (let col = 0; col < alignedSeq.length; col++) {
    const ch = alignedSeq[col];
    if (ch !== '-' && ch !== '.' && ch !== undefined) {
      out.push(col);
    }
  }
  return out;
}

/**
 * Resolve a domain's residue range to an inclusive column range
 * `[startCol, endCol]` in the aligned sequence. Returns `null` when the
 * domain falls entirely outside the sequence's residue count (rare data
 * issue) so callers can skip rendering.
 *
 * Both `start` and `end` are clamped into the sequence's residue range so
 * a slightly out-of-range hit still renders as much as it can.
 */
export function domainColumnRange(
  domain: ProteinDomain,
  colByResidue: number[],
): { startCol: number; endCol: number } | null {
  const lastResidue = colByResidue.length - 1;
  if (lastResidue <= 0) return null;
  const start = Math.max(1, Math.min(lastResidue, domain.start));
  const end = Math.max(start, Math.min(lastResidue, domain.end));
  return { startCol: colByResidue[start], endCol: colByResidue[end] };
}

/**
 * For each MSA column, returns the dominant domain id — the one held by
 * the most leaves in `activeGeneIds` whose hit covers that column. Returns
 * `null` for columns with no domain coverage. Ties are broken by the
 * lexically smallest id so the result is deterministic.
 *
 * Used both by the header's minimap (per-column "domain track") and by the
 * body's "Plain" colour scheme (per-residue domain colouring).
 */
export function computeDominantDomainByCol(
  msa: MSA,
  proteinDomains: Record<GeneId, ProteinDomain[]> | undefined,
  activeGeneIds: ReadonlySet<GeneId>,
): (string | null)[] {
  const length = msa.length;
  const result = new Array<string | null>(length).fill(null);
  if (!proteinDomains) return result;
  const counts: Array<Map<string, number> | null> = new Array(length).fill(null);
  for (const geneId of activeGeneIds) {
    const hits = proteinDomains[geneId];
    if (!hits || hits.length === 0) continue;
    const seq = msa.sequences[geneId];
    if (!seq) continue;
    const map = buildResidueToColumn(seq);
    for (const d of hits) {
      const range = domainColumnRange(d, map);
      if (!range) continue;
      for (let c = range.startCol; c <= range.endCol; c++) {
        let row = counts[c];
        if (!row) {
          row = new Map();
          counts[c] = row;
        }
        row.set(d.id, (row.get(d.id) ?? 0) + 1);
      }
    }
  }
  for (let c = 0; c < length; c++) {
    const row = counts[c];
    if (!row) continue;
    let bestId: string | null = null;
    let bestN = 0;
    for (const [id, n] of row) {
      if (n > bestN || (n === bestN && bestId !== null && id < bestId)) {
        bestN = n;
        bestId = id;
      }
    }
    result[c] = bestId;
  }
  return result;
}

/**
 * Stable hash → CSS HSL colour for a domain id, so the same Pfam id (or
 * other accession) always renders in the same colour across leaves and
 * sessions. Hue is the only varied channel; saturation and lightness are
 * tuned for legibility on the MSA's pale grey background.
 */
export function domainColor(id: string): string {
  // FNV-1a-ish 32-bit hash; deterministic and dependency-free.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 65% 45%)`;
}
