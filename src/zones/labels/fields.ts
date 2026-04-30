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
