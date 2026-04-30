import type { MSA } from '../../types';

export type ColorSchemeId = 'plain' | 'clustal' | 'hydrophobicity' | 'nucleotide';

export interface ColorScheme {
  id: ColorSchemeId;
  label: string;
  alphabets: ReadonlyArray<MSA['alphabet']>;
  /** Returns a CSS colour for the residue, or null to use the default. */
  color: (residue: string) => string | null;
}

const CLUSTAL: Record<string, string> = {
  // hydrophobic
  A: '#80a0f0', I: '#80a0f0', L: '#80a0f0', M: '#80a0f0',
  F: '#80a0f0', W: '#80a0f0', V: '#80a0f0',
  // positive
  K: '#f01505', R: '#f01505',
  // negative
  D: '#c048c0', E: '#c048c0',
  // polar
  N: '#15c015', Q: '#15c015', S: '#15c015', T: '#15c015',
  // cysteine
  C: '#f08080',
  // glycine
  G: '#f09048',
  // proline
  P: '#c0c000',
  // histidine + tyrosine
  H: '#15a4a4', Y: '#15a4a4',
};

// Kyte-Doolittle hydrophobicity scale.
const KD: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8,
  G: -0.4, T: -0.7, S: -0.8, W: -0.9, Y: -1.3, P: -1.6,
  H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};
const KD_MIN = -4.5;
const KD_MAX = 4.5;

function kdColor(residue: string): string | null {
  const v = KD[residue];
  if (v === undefined) return null;
  // Map [-4.5, 4.5] → [blue, white, red].
  const t = (v - KD_MIN) / (KD_MAX - KD_MIN); // 0..1
  if (t < 0.5) {
    const k = t / 0.5;
    const r = Math.round(80 + (255 - 80) * k);
    const g = Math.round(120 + (255 - 120) * k);
    const b = Math.round(220 + (255 - 220) * k);
    return `rgb(${r},${g},${b})`;
  } else {
    const k = (t - 0.5) / 0.5;
    const r = Math.round(255 + (220 - 255) * k);
    const g = Math.round(255 + (90 - 255) * k);
    const b = Math.round(255 + (60 - 255) * k);
    return `rgb(${r},${g},${b})`;
  }
}

const NUCLEOTIDE: Record<string, string> = {
  A: '#5ab33c',
  C: '#3782e3',
  G: '#1a1a1a',
  T: '#e85a4a',
  U: '#e85a4a',
  N: '#999',
};

export const COLOR_SCHEMES: ColorScheme[] = [
  {
    id: 'plain',
    label: 'Plain',
    alphabets: ['protein', 'dna'],
    color: () => null,
  },
  {
    id: 'clustal',
    label: 'Clustal',
    alphabets: ['protein'],
    color: (r) => CLUSTAL[r.toUpperCase()] ?? null,
  },
  {
    id: 'hydrophobicity',
    label: 'Hydrophobicity',
    alphabets: ['protein'],
    color: (r) => kdColor(r.toUpperCase()),
  },
  {
    id: 'nucleotide',
    label: 'Nucleotide',
    alphabets: ['dna'],
    color: (r) => NUCLEOTIDE[r.toUpperCase()] ?? null,
  },
];

export function defaultSchemeFor(alphabet: MSA['alphabet']): ColorSchemeId {
  return alphabet === 'dna' ? 'nucleotide' : 'clustal';
}

export function applicableSchemes(alphabet: MSA['alphabet']): ColorScheme[] {
  return COLOR_SCHEMES.filter((s) => s.alphabets.includes(alphabet));
}

export function getScheme(id: ColorSchemeId | undefined): ColorScheme {
  return COLOR_SCHEMES.find((s) => s.id === id) ?? COLOR_SCHEMES[0];
}
