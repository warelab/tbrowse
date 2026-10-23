import { describe, expect, it } from 'vitest';
import { averageDosage, decodeCall } from './encoding';
import type { GenotypeMatrix } from '../types';

describe('decodeCall', () => {
  it('parses an unphased homozygous-ref diploid call', () => {
    const c = decodeCall('0/0');
    expect(c).toEqual({
      alleles: [0, 0],
      phased: false,
      altDosage: 0,
      missing: false,
    });
  });

  it('parses a heterozygous unphased call', () => {
    const c = decodeCall('0/1');
    expect(c.altDosage).toBe(1);
    expect(c.phased).toBe(false);
  });

  it('parses a phased compound-het call', () => {
    const c = decodeCall('1|2');
    expect(c.phased).toBe(true);
    expect(c.altDosage).toBe(2);
    expect(c.alleles).toEqual([1, 2]);
  });

  it('treats `.` and empty fields as missing', () => {
    const c = decodeCall('./.');
    expect(c.missing).toBe(true);
    expect(c.alleles).toEqual([-1, -1]);
    const empty = decodeCall('');
    expect(empty.missing).toBe(true);
  });

  it('counts multi-allelic homozygous as 2-dose', () => {
    expect(decodeCall('3/3').altDosage).toBe(2);
    expect(decodeCall('0/3').altDosage).toBe(1);
  });

  it('honours custom separators', () => {
    const c = decodeCall('0_1', '*', '_', '?');
    expect(c.altDosage).toBe(1);
    expect(c.phased).toBe(false);
  });
});

describe('averageDosage', () => {
  const matrix: GenotypeMatrix = {
    variants: [{ id: 'v1' }, { id: 'v2' }],
    callsByGeneId: {
      a: ['0/0', '1/1'],
      b: ['0/1', '0/0'],
      c: ['1/1', './.'],
    },
  };

  it('averages dosage across leaves at one variant', () => {
    expect(averageDosage(matrix, ['a', 'b', 'c'], 0)).toBeCloseTo((0 + 1 + 2) / 3);
  });

  it('skips fully-missing calls', () => {
    expect(averageDosage(matrix, ['a', 'b', 'c'], 1)).toBeCloseTo((2 + 0) / 2);
  });

  it('returns null when every contributor is missing', () => {
    expect(averageDosage(matrix, ['c'], 1)).toBeNull();
  });
});
