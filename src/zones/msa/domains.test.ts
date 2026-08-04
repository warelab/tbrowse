import { describe, expect, it } from 'vitest';
import {
  buildResidueToColumn,
  domainColor,
  domainColumnRange,
} from './domains';

describe('buildResidueToColumn', () => {
  it('skips gaps when mapping residues to columns', () => {
    // residues:  M  K - - L  V (residue 1..4 → cols 0,1,4,5)
    const map = buildResidueToColumn('MK--LV');
    expect(map).toEqual([0, 0, 1, 4, 5]);
  });

  it('handles all-gap sequences', () => {
    expect(buildResidueToColumn('---')).toEqual([0]);
  });

  it('treats both - and . as gap characters', () => {
    // residues:  M . K - L (residue 1..3 → cols 0,2,4)
    const map = buildResidueToColumn('M.K-L');
    expect(map).toEqual([0, 0, 2, 4]);
  });
});

describe('domainColumnRange', () => {
  const map = buildResidueToColumn('MK--LV'); // 4 residues
  it('translates inclusive residue range to column range', () => {
    expect(domainColumnRange({ id: 'A', name: '', start: 2, end: 3 }, map)).toEqual({
      startCol: 1,
      endCol: 4,
    });
  });

  it('clamps out-of-range hits into the available residues', () => {
    expect(domainColumnRange({ id: 'A', name: '', start: 0, end: 99 }, map)).toEqual({
      startCol: 0,
      endCol: 5,
    });
  });

  it('returns null on a sequence with no residues', () => {
    expect(
      domainColumnRange({ id: 'A', name: '', start: 1, end: 1 }, [0]),
    ).toBeNull();
  });
});

describe('domainColor', () => {
  it('is deterministic and produces an hsl() color string', () => {
    const a = domainColor('PF00069');
    const b = domainColor('PF00069');
    expect(a).toBe(b);
    expect(a.startsWith('hsl(')).toBe(true);
  });

  it('gives different ids different colors (in the typical case)', () => {
    expect(domainColor('PF00069')).not.toBe(domainColor('PF00271'));
  });
});
