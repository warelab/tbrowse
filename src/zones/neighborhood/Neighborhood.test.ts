import { describe, expect, it } from 'vitest';
import type { Neighborhood, NeighborhoodGene } from '../../types';
import { buildFamilyPalette } from './Neighborhood';

const CENTER_HUE = 130;

function gene(
  id: string,
  geneTree: string | undefined,
  start: number,
  end: number,
): NeighborhoodGene {
  return { id, geneTree, strand: 1, start, end };
}

function nh(
  centerId: string,
  centerFamily: string,
  upstream: NeighborhoodGene[],
  downstream: NeighborhoodGene[],
): Neighborhood {
  return {
    center: gene(centerId, centerFamily, 1000, 1100),
    upstream,
    downstream,
  };
}

describe('buildFamilyPalette', () => {
  const neighborhoods: Record<string, Neighborhood> = {
    A: nh(
      'A',
      'famA',
      [gene('a-up1', 'famX', 100, 200), gene('a-up2', 'famY', 400, 500)],
      [gene('a-dn1', 'famZ', 1300, 1400), gene('a-dn2', 'famQ', 1600, 1700)],
    ),
    B: nh(
      'B',
      'famZ',
      [gene('b-up1', 'famQ', 100, 200)],
      [gene('b-dn1', 'famA', 1300, 1400)],
    ),
    // A row contributing only to overall frequency counts.
    C: nh(
      'C',
      'famQ',
      [gene('c-up1', 'famA', 100, 200)],
      [gene('c-dn1', 'famZ', 1300, 1400)],
    ),
  };

  it("centre family of NoI's neighbourhood is pinned to green", () => {
    const palette = buildFamilyPalette(neighborhoods, 'A');
    expect(palette.get('famA')).toBe(CENTER_HUE);
  });

  it('switching NoI moves green to the new centre family', () => {
    const before = buildFamilyPalette(neighborhoods, 'A');
    const after = buildFamilyPalette(neighborhoods, 'B');
    expect(before.get('famA')).toBe(CENTER_HUE);
    expect(after.get('famZ')).toBe(CENTER_HUE);
    // famA was green under NoI=A; under NoI=B it must be a different
    // color (it sits in B's downstream rainbow region).
    expect(after.get('famA')).not.toBe(CENTER_HUE);
    // famZ was rainbow-colored under NoI=A; now it's green.
    expect(before.get('famZ')).not.toBe(CENTER_HUE);
  });

  it("families flanking NoI's centre populate the rainbow gradient", () => {
    const palette = buildFamilyPalette(neighborhoods, 'A');
    // Upstream side sits in [130, 290]; downstream sits in [350, 130]
    // (i.e. wrapping through 0). Verify each upstream family lands in
    // the upstream half and each downstream family in the downstream
    // half.
    const upX = palette.get('famX')!;
    const upY = palette.get('famY')!;
    const dnZ = palette.get('famZ')!;
    const dnQ = palette.get('famQ')!;
    expect(upX).toBeGreaterThan(CENTER_HUE);
    expect(upX).toBeLessThan(290);
    expect(upY).toBeGreaterThan(CENTER_HUE);
    expect(upY).toBeLessThan(290);
    // Downstream hues land in [0, 130) or wrap through to [350, 360).
    const inDownstream = (h: number) => h < CENTER_HUE || h >= 350;
    expect(inDownstream(dnZ)).toBe(true);
    expect(inDownstream(dnQ)).toBe(true);
  });

  it('returns an empty palette when there is no neighbourhood data', () => {
    expect(buildFamilyPalette(undefined, 'A').size).toBe(0);
    expect(buildFamilyPalette({}, 'A').size).toBe(0);
  });

  it('still assigns colors to every family even with no NoI', () => {
    const palette = buildFamilyPalette(neighborhoods, undefined);
    // No centre pinned to green — every family falls through the
    // descending-frequency / interpolation pass and gets some hue.
    for (const family of ['famA', 'famX', 'famY', 'famZ', 'famQ']) {
      expect(palette.has(family)).toBe(true);
    }
  });
});
