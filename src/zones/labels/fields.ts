import type { HostData, LabelProvider, TreeNode } from '../../types';

export interface BuiltinLabelField {
  kind: 'builtin';
  id: string;
  label: string;
  /** Synchronous resolver. Returns null when the value isn't available. */
  get: (node: TreeNode, data: HostData) => string | null;
}

export interface ProviderLabelField {
  kind: 'provider';
  id: string;
  label: string;
  providerId: string;
}

export type LabelField = BuiltinLabelField | ProviderLabelField;

export const builtInFields: BuiltinLabelField[] = [
  {
    kind: 'builtin',
    id: 'gene.id',
    label: 'Gene ID',
    get: (n) => n.geneId ?? null,
  },
  {
    kind: 'builtin',
    id: 'gene.name',
    label: 'Gene name',
    get: (n, d) => {
      if (!n.geneId) return null;
      const v = d.geneMetadata?.[n.geneId]?.displayName;
      return typeof v === 'string' ? v : null;
    },
  },
  {
    kind: 'builtin',
    id: 'gene.description',
    label: 'Gene description',
    get: (n, d) => {
      if (!n.geneId) return null;
      const v = d.geneMetadata?.[n.geneId]?.description;
      return typeof v === 'string' ? v : null;
    },
  },
  {
    kind: 'builtin',
    id: 'taxonomy.scientificName',
    label: 'Scientific name',
    get: (n, d) => {
      if (n.taxonomyId === undefined) return null;
      return d.taxonomy?.[n.taxonomyId]?.scientificName ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'taxonomy.commonName',
    label: 'Common name',
    get: (n, d) => {
      if (n.taxonomyId === undefined) return null;
      return d.taxonomy?.[n.taxonomyId]?.commonName ?? null;
    },
  },
  // Germplasm fields. Keyed by the leaf's `geneId` field, which for
  // germplasm trees carries the germplasmDbId / germplasmName. They
  // return null when no germplasm record exists, so they're invisible
  // on gene trees and other non-germplasm sources.
  {
    kind: 'builtin',
    id: 'germplasm.id',
    label: 'Germplasm ID',
    get: (n) => n.geneId ?? null,
  },
  {
    kind: 'builtin',
    id: 'germplasm.name',
    label: 'Germplasm name',
    get: (n, d) => {
      if (!n.geneId) return null;
      const g = d.germplasm?.[n.geneId];
      return g?.defaultDisplayName ?? g?.germplasmName ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'germplasm.species',
    label: 'Species',
    get: (n, d) => {
      if (!n.geneId) return null;
      const g = d.germplasm?.[n.geneId];
      if (!g) return null;
      // Genus + species reads more naturally than species alone for plant
      // material; fall back to species alone when genus is absent.
      if (g.genus && g.species) return `${g.genus} ${g.species}`;
      return g.species ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'germplasm.crop',
    label: 'Crop',
    get: (n, d) => {
      if (!n.geneId) return null;
      return d.germplasm?.[n.geneId]?.commonCropName ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'germplasm.accession',
    label: 'Accession',
    get: (n, d) => {
      if (!n.geneId) return null;
      return d.germplasm?.[n.geneId]?.accessionNumber ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'germplasm.pedigree',
    label: 'Pedigree',
    get: (n, d) => {
      if (!n.geneId) return null;
      return d.germplasm?.[n.geneId]?.pedigree ?? null;
    },
  },
  {
    kind: 'builtin',
    id: 'germplasm.country',
    label: 'Country of origin',
    get: (n, d) => {
      if (!n.geneId) return null;
      return d.germplasm?.[n.geneId]?.countryOfOriginCode ?? null;
    },
  },
];

/** Derive provider-backed fields from the host's registered labelProviders. */
export function providerFields(providers: readonly LabelProvider[] | undefined): ProviderLabelField[] {
  if (!providers || providers.length === 0) return [];
  return providers.map((p) => ({
    kind: 'provider',
    id: p.id,
    label: p.label,
    providerId: p.id,
  }));
}

/** Returns built-in + provider fields, in canonical order. */
export function allFields(data: HostData): LabelField[] {
  return [...builtInFields, ...providerFields(data.labelProviders)];
}
