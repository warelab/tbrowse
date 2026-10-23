import { describe, expect, it } from 'vitest';
import { decodeCall, type VariantSite } from 'tbrowse-core';
import {
  alleleChar,
  callToAlleles,
  createGenotypeMatrixZone,
  fullAllele,
  genotypeText,
  isIndel,
  textColorForCall,
  variantLabel,
} from './Genotype';

const snp: VariantSite = { id: 'rs1', reference: '1', position: 1234567, ref: 'A', alt: ['T', 'G'] };
const indel: VariantSite = { id: '1:200', ref: 'GTTTC', alt: ['G'] };
const bare: VariantSite = { id: 'v' };

describe('alleleChar / fullAllele', () => {
  it('maps 0 to REF and n to ALT[n-1]', () => {
    expect(alleleChar(0, snp)).toBe('A');
    expect(alleleChar(1, snp)).toBe('T');
    expect(alleleChar(2, snp)).toBe('G');
    expect(fullAllele(0, snp)).toBe('A');
    expect(fullAllele(2, snp)).toBe('G');
  });

  it('abbreviates indels to the first base but keeps them in fullAllele', () => {
    expect(alleleChar(0, indel)).toBe('G');
    expect(fullAllele(0, indel)).toBe('GTTTC');
  });

  it('uses "." for missing and "?" for out-of-range or absent metadata', () => {
    expect(alleleChar(-1, snp)).toBe('.');
    expect(fullAllele(-1, snp)).toBe('.');
    expect(alleleChar(3, snp)).toBe('?');
    expect(fullAllele(3, snp)).toBe('?');
    expect(alleleChar(0, bare)).toBe('?');
    expect(alleleChar(1, undefined)).toBe('?');
  });
});

describe('isIndel', () => {
  it('is true only for multi-character REF or ALT', () => {
    expect(isIndel(snp)).toBe(false);
    expect(isIndel(indel)).toBe(true);
    expect(isIndel({ id: 'x', ref: 'A', alt: ['AT'] })).toBe(true);
    expect(isIndel(undefined)).toBe(false);
  });
});

describe('callToAlleles', () => {
  it('renders full allele strings with the call separator', () => {
    expect(callToAlleles(decodeCall('0/1'), indel, '0/1')).toBe('GTTTC/G');
    expect(callToAlleles(decodeCall('1|2'), snp, '1|2')).toBe('T|G');
  });

  it('falls back to the raw call without REF/ALT metadata', () => {
    expect(callToAlleles(decodeCall('0/1'), bare, '0/1')).toBe('0/1');
    expect(callToAlleles(decodeCall('0/1'), undefined, '0/1')).toBe('0/1');
  });
});

describe('genotypeText', () => {
  it('returns letters once REF/ALT are known', () => {
    expect(genotypeText(decodeCall('0/1'), snp, false, 20)).toBe('AT');
    expect(genotypeText(decodeCall('2/2'), snp, false, 20)).toBe('GG');
  });

  it('returns null without metadata and "." for a fully-missing call', () => {
    expect(genotypeText(decodeCall('0/1'), bare, false, 20)).toBeNull();
    expect(genotypeText(decodeCall('./.'), snp, false, 20)).toBe('.');
  });

  it('shows the phase separator only when phased, enabled and wide enough', () => {
    const phased = decodeCall('0|1');
    expect(genotypeText(phased, snp, true, 30)).toBe('A|T');
    expect(genotypeText(phased, snp, true, 20)).toBe('AT');
    expect(genotypeText(phased, snp, false, 30)).toBe('AT');
    expect(genotypeText(decodeCall('0/1'), snp, true, 30)).toBe('AT');
    expect(genotypeText(phased, snp, true, 20, 18)).toBe('A|T');
  });
});

describe('variantLabel / textColorForCall', () => {
  it('labels by coordinate when present, else by id', () => {
    expect(variantLabel(snp)).toBe(`1:${(1234567).toLocaleString()}`);
    expect(variantLabel({ id: 'x', position: 5 })).toBe('5');
    expect(variantLabel(bare)).toBe('v');
  });

  it('uses white text only on the dark homozygous-ALT fill', () => {
    expect(textColorForCall(decodeCall('1/1'))).toBe('#ffffff');
    expect(textColorForCall(decodeCall('0/1'))).toBe('#1a2733');
    expect(textColorForCall(decodeCall('0/0'))).toBe('#1a2733');
  });
});

describe('createGenotypeMatrixZone', () => {
  it('builds a detail-group zone whose availability follows the matrix', () => {
    const zone = createGenotypeMatrixZone({
      id: 'gt',
      matrix: { variants: [snp], callsByGeneId: { g1: ['0/1'] } },
      initial: { showPhasing: true },
    });
    expect(zone.id).toBe('gt');
    expect(zone.displayName).toBe('Genotypes');
    expect(zone.exclusiveGroup).toBe('detail');
    expect(zone.defaultWidth).toBe(30);
    expect(zone.minWidth).toBe(200);
    expect(zone.defaultZoneState).toEqual({ zoom: 1, panPx: 0, showPhasing: true });
    expect(zone.isAvailable({ tree: { nodes: {}, rootId: '' } } as never)).toBe(true);

    const empty = createGenotypeMatrixZone({
      id: 'gt2',
      displayName: 'SNPs',
      matrix: { variants: [], callsByGeneId: {} },
      defaultWidth: 40,
      minWidth: 120,
      defaultVisible: false,
    });
    expect(empty.displayName).toBe('SNPs');
    expect(empty.defaultWidth).toBe(40);
    expect(empty.minWidth).toBe(120);
    expect(empty.defaultVisible).toBe(false);
    expect(empty.isAvailable({ tree: { nodes: {}, rootId: '' } } as never)).toBe(false);
  });
});
