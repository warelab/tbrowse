import type { TableData } from './types';

export interface HeatmapDomain {
  min: number;
  max: number;
}

/** Build a per-column min/max domain across every value in the table.
 *  Computed once at zone-build time so heatmap colouring is stable as
 *  rows collapse / prune (the domain is "this column overall", not
 *  "what's currently visible"). */
export function buildHeatmapDomains(
  table: TableData,
  columnIds: string[],
): Record<string, HeatmapDomain> {
  const out: Record<string, HeatmapDomain> = {};
  for (const colId of columnIds) {
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    for (const row of Object.values(table)) {
      const v = row?.[colId];
      if (typeof v === 'number' && Number.isFinite(v)) {
        any = true;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (any) out[colId] = { min, max };
  }
  return out;
}

/** Map a numeric value into [0, 1] within `domain`. Values outside the
 *  domain are clamped. Returns null when the domain is degenerate. */
export function normalize(value: number, domain: HeatmapDomain): number | null {
  const { min, max } = domain;
  if (!Number.isFinite(value)) return null;
  if (max === min) return 0.5;
  if (value <= min) return 0;
  if (value >= max) return 1;
  return (value - min) / (max - min);
}

/** Pick a background colour for a heatmap cell at normalized intensity
 *  `t` ∈ [0, 1]. Sequential palette from light grey through the brand
 *  accent. Theme-aware: in dark mode the low end is a near-black so the
 *  ramp still ends at the brighter accent. */
export function heatmapBackground(t: number, theme: 'light' | 'dark'): string {
  // Two anchor stops; LERP in linear RGB approximation.
  const low = theme === 'dark' ? [40, 50, 65] : [240, 244, 250];
  const high = theme === 'dark' ? [120, 180, 250] : [40, 120, 220];
  const r = Math.round(low[0] + (high[0] - low[0]) * t);
  const g = Math.round(low[1] + (high[1] - low[1]) * t);
  const b = Math.round(low[2] + (high[2] - low[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Pick a foreground colour that stays legible on top of
 *  `heatmapBackground(t, theme)`. Light text once the cell is dark
 *  enough to need it. */
export function heatmapForeground(t: number, theme: 'light' | 'dark'): string {
  if (theme === 'dark') return t > 0.4 ? '#0e1116' : '#e7e9ed';
  return t > 0.55 ? '#ffffff' : '#222222';
}
