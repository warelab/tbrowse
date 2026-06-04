import { describe, expect, it } from 'vitest';
import { residueGlyphPx } from './MSA';

// Zoom thresholds from MSA.tsx: single letters render at residueWidth >= 7,
// three-letter codes at >= 22.
describe('residueGlyphPx', () => {
  it('preserves the historical default look at base 12', () => {
    // Single-letter at its render threshold → 11px (unchanged from before).
    expect(residueGlyphPx(12, 7, false)).toBe(11);
    // Three-letter at its render threshold → 10px (unchanged from before).
    expect(residueGlyphPx(12, 22, true)).toBe(10);
  });

  it('caps the glyph so it fits the column when zoomed out', () => {
    // Narrow column: single-letter glyph is bounded by ~1.6 × column width.
    expect(residueGlyphPx(20, 7, false)).toBeCloseTo(11.2, 5);
    // Three-letter glyph is bounded by ~0.55 × column width.
    expect(residueGlyphPx(20, 22, true)).toBeCloseTo(12.1, 5);
  });

  it('scales residues up with the base font where the column has room', () => {
    // Wide single-letter column: base font (minus 1) wins over the cap.
    expect(residueGlyphPx(18, 40, false)).toBe(17);
    // Wide three-letter column: base font (minus 2) wins.
    expect(residueGlyphPx(18, 60, true)).toBe(16);
  });

  it('never shrinks below a 6px floor', () => {
    expect(residueGlyphPx(6, 1, false)).toBe(6);
    expect(residueGlyphPx(4, 1, true)).toBe(6);
  });
});
