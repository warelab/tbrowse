import { describe, expect, it } from 'vitest';
import { ENSEMBL_DEFAULT_MIRROR, ENSEMBL_MIRRORS, ensemblGeneTreeUrl, mirrorFor } from './ensembl';

describe('Ensembl mirrors', () => {
  it('lists the current endpoint first and resolves known hosts', () => {
    expect(ENSEMBL_MIRRORS[0]?.host).toBe(ENSEMBL_DEFAULT_MIRROR);
    expect(mirrorFor('feb2023.rest.ensembl.org')).toEqual({ host: 'feb2023.rest.ensembl.org', release: 109, route: 'bare' });
  });
  it('infers the route for an unknown host from its release', () => {
    expect(mirrorFor('new.rest.ensembl.org', 117).route).toBe('species');
    expect(mirrorFor('old.rest.ensembl.org', 104).route).toBe('bare');
    expect(mirrorFor('new.rest.ensembl.org').release).toBe(ENSEMBL_MIRRORS[0]?.release);
  });
  it('builds the species route for >= 112 and the bare route below 110 (playground main.tsx:126-136)', () => {
    expect(ensemblGeneTreeUrl('ENSG00000139618')).toBe(
      'https://rest.ensembl.org/genetree/member/id/homo_sapiens/ENSG00000139618?aligned=1&sequence=protein',
    );
    expect(ensemblGeneTreeUrl('ENSG00000139618', { host: 'dec2021.rest.ensembl.org' })).toBe(
      'https://dec2021.rest.ensembl.org/genetree/member/id/ENSG00000139618?aligned=1&sequence=protein',
    );
    expect(ensemblGeneTreeUrl('ENSMUSG00000041147', { species: 'mus_musculus', sequence: 'cdna', aligned: false })).toBe(
      'https://rest.ensembl.org/genetree/member/id/mus_musculus/ENSMUSG00000041147?aligned=0&sequence=cdna',
    );
  });
});
