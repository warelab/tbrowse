import type { HostData, TreeNode } from '../../types';

export interface LabelField {
  /** Stable id used in viewState.zoneStates['labels'].visibleFields. */
  id: string;
  /** Human-readable name shown in the field picker. */
  label: string;
  /**
   * Resolve a value for this field given the leaf's tree node + host data.
   * Return null when the value isn't available so the renderer can skip it.
   */
  get: (node: TreeNode, data: HostData) => string | null;
}

export const builtInFields: LabelField[] = [
  {
    id: 'gene.id',
    label: 'Gene ID',
    get: (n) => n.geneId ?? null,
  },
  {
    id: 'gene.name',
    label: 'Gene name',
    get: (n, d) => {
      if (!n.geneId) return null;
      const v = d.geneMetadata?.[n.geneId]?.displayName;
      return typeof v === 'string' ? v : null;
    },
  },
  {
    id: 'gene.description',
    label: 'Gene description',
    get: (n, d) => {
      if (!n.geneId) return null;
      const v = d.geneMetadata?.[n.geneId]?.description;
      return typeof v === 'string' ? v : null;
    },
  },
  {
    id: 'taxonomy.scientificName',
    label: 'Scientific name',
    get: (n, d) => {
      if (n.taxonomyId === undefined) return null;
      return d.taxonomy?.[n.taxonomyId]?.scientificName ?? null;
    },
  },
  {
    id: 'taxonomy.commonName',
    label: 'Common name',
    get: (n, d) => {
      if (n.taxonomyId === undefined) return null;
      return d.taxonomy?.[n.taxonomyId]?.commonName ?? null;
    },
  },
];
