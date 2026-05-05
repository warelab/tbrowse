import type { TableData } from './types';

export interface HeatmapDomain {
  min: number;
  max: number;
}

export type PaletteKind = 'sequential' | 'diverging';

type Stops = ReadonlyArray<readonly [number, number, number]>;

export interface Palette {
  id: string;
  label: string;
  kind: PaletteKind;
  /** Light/dark stop arrays. Sequential palettes have 2 stops (low →
   *  high); diverging palettes have 3 (low → mid → high). The mid stop
   *  is anchored to the user-chosen midpoint at render time, not the
   *  middle of the data domain. */
  light: Stops;
  dark: Stops;
}

const SEQUENTIAL: ReadonlyArray<Palette> = [
  {
    id: 'blue',
    label: 'Blue',
    kind: 'sequential',
    light: [[240, 244, 250], [40, 120, 220]],
    dark: [[40, 50, 65], [120, 180, 250]],
  },
  {
    id: 'orange',
    label: 'Orange',
    kind: 'sequential',
    light: [[255, 245, 235], [217, 95, 14]],
    dark: [[55, 40, 25], [255, 160, 80]],
  },
  {
    id: 'purple',
    label: 'Purple',
    kind: 'sequential',
    light: [[247, 242, 252], [106, 81, 163]],
    dark: [[40, 30, 55], [180, 140, 230]],
  },
  {
    id: 'green',
    label: 'Green',
    kind: 'sequential',
    light: [[240, 250, 240], [35, 139, 69]],
    dark: [[30, 55, 40], [120, 200, 140]],
  },
  {
    id: 'gray',
    label: 'Grayscale',
    kind: 'sequential',
    light: [[245, 245, 245], [80, 80, 80]],
    dark: [[40, 42, 48], [200, 200, 200]],
  },
];

const DIVERGING: ReadonlyArray<Palette> = [
  {
    id: 'rdbu',
    label: 'Red ↔ Blue',
    kind: 'diverging',
    light: [[178, 24, 43], [247, 247, 247], [33, 102, 172]],
    dark: [[230, 90, 90], [40, 42, 48], [110, 170, 230]],
  },
  {
    id: 'rdylbu',
    label: 'Red ↔ Yellow ↔ Blue',
    kind: 'diverging',
    light: [[215, 48, 39], [255, 255, 191], [69, 117, 180]],
    dark: [[230, 90, 80], [220, 220, 170], [110, 150, 210]],
  },
  {
    id: 'brbg',
    label: 'Brown ↔ Teal',
    kind: 'diverging',
    light: [[140, 81, 10], [245, 245, 245], [1, 102, 94]],
    dark: [[200, 150, 90], [40, 42, 48], [80, 180, 170]],
  },
  {
    id: 'puor',
    label: 'Purple ↔ Orange',
    kind: 'diverging',
    light: [[94, 60, 153], [247, 247, 247], [230, 97, 1]],
    dark: [[160, 130, 200], [40, 42, 48], [240, 160, 90]],
  },
];

export const PALETTES: ReadonlyArray<Palette> = [...SEQUENTIAL, ...DIVERGING];

export const DEFAULT_SEQUENTIAL_PALETTE = 'blue';
export const DEFAULT_DIVERGING_PALETTE = 'rdbu';

const PALETTE_BY_ID = new Map(PALETTES.map((p) => [p.id, p]));

export function paletteById(id: string | undefined): Palette {
  if (id) {
    const p = PALETTE_BY_ID.get(id);
    if (p) return p;
  }
  return PALETTE_BY_ID.get(DEFAULT_SEQUENTIAL_PALETTE)!;
}

/** Auto-pick a sensible default palette for the given domain: a
 *  diverging palette when the domain crosses zero, sequential
 *  otherwise. Used when neither factory nor override specifies a
 *  palette. */
export function autoPalette(domain: HeatmapDomain): Palette {
  if (domain.min < 0 && domain.max > 0) {
    return PALETTE_BY_ID.get(DEFAULT_DIVERGING_PALETTE)!;
  }
  return PALETTE_BY_ID.get(DEFAULT_SEQUENTIAL_PALETTE)!;
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

/** Compute the heatmap colour for `value` against `domain` using
 *  `palette`. For diverging palettes, `midpoint` (default 0) anchors
 *  the central stop; values <= midpoint scale across the low → mid
 *  ramp, values > midpoint across the mid → high ramp. Returns null
 *  for a degenerate domain or non-finite value. */
export function colorAt(
  value: number,
  domain: HeatmapDomain,
  palette: Palette,
  theme: 'light' | 'dark',
  midpoint = 0,
): readonly [number, number, number] | null {
  if (!Number.isFinite(value)) return null;
  const stops = theme === 'dark' ? palette.dark : palette.light;
  if (palette.kind === 'sequential') {
    const t = remap01(value, domain.min, domain.max);
    return lerpRgb(stops[0], stops[stops.length - 1], t);
  }
  // Diverging: each side scales independently.
  const lo = Math.min(domain.min, midpoint);
  const hi = Math.max(domain.max, midpoint);
  if (value <= midpoint) {
    if (lo === midpoint) return stops[1];
    const t = remap01(value, lo, midpoint);
    return lerpRgb(stops[0], stops[1], t);
  } else {
    if (hi === midpoint) return stops[1];
    const t = remap01(value, midpoint, hi);
    return lerpRgb(stops[1], stops[2], t);
  }
}

function remap01(v: number, a: number, b: number): number {
  if (a === b) return 0.5;
  if (v <= a) return 0;
  if (v >= b) return 1;
  return (v - a) / (b - a);
}

function lerpRgb(
  a: Stops[number],
  b: Stops[number],
  t: number,
): readonly [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rgbCss(rgb: readonly [number, number, number]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** Pick a foreground colour with adequate contrast on `bgRgb`. Uses
 *  relative luminance so the heuristic generalises beyond a single
 *  palette / sweep direction. */
export function readableForeground(
  bgRgb: readonly [number, number, number],
  theme: 'light' | 'dark',
): string {
  const L =
    (0.2126 * bgRgb[0] + 0.7152 * bgRgb[1] + 0.0722 * bgRgb[2]) / 255;
  if (theme === 'dark') return L < 0.5 ? '#e7e9ed' : '#0e1116';
  return L > 0.55 ? '#222222' : '#ffffff';
}
