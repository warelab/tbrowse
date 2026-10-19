export { TBrowse } from './TBrowse';
export { ensureThemeStylesInjected } from './theme';
export { TBrowseLogo } from './icons/TBrowseLogo';

// ---------------------------------------------------------------------------
// Headless helpers that moved to tbrowse-core in 2.11. They are re-exported
// here so 2.x consumers keep compiling; import them from 'tbrowse-core'
// instead. Declared as local constants (not `export { x } from`) so the
// @deprecated tag survives the rolled-up declaration file. These function
// re-exports are removed in tbrowse 3.0 (the type re-exports below stay).
// ---------------------------------------------------------------------------
import * as core from 'tbrowse-core';
/** @deprecated Import `fromEnsemblGeneTree` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromEnsemblGeneTree: typeof core.fromEnsemblGeneTree = core.fromEnsemblGeneTree;
/** @deprecated Import `fromEnsemblGeneStructure` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromEnsemblGeneStructure: typeof core.fromEnsemblGeneStructure = core.fromEnsemblGeneStructure;
/** @deprecated Import `fromEnsemblGenomeFeatures` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromEnsemblGenomeFeatures: typeof core.fromEnsemblGenomeFeatures = core.fromEnsemblGenomeFeatures;
/** @deprecated Import `fromEnsemblProteinFeatures` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromEnsemblProteinFeatures: typeof core.fromEnsemblProteinFeatures = core.fromEnsemblProteinFeatures;
/** @deprecated Import `fromGrameneGene` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromGrameneGene: typeof core.fromGrameneGene = core.fromGrameneGene;
/** @deprecated Import `fromGrameneGenetree` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromGrameneGenetree: typeof core.fromGrameneGenetree = core.fromGrameneGenetree;
/** @deprecated Import `fromGrameneGeneStructures` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromGrameneGeneStructures: typeof core.fromGrameneGeneStructures = core.fromGrameneGeneStructures;
/** @deprecated Import `fromGrameneNeighborhood` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const fromGrameneNeighborhood: typeof core.fromGrameneNeighborhood = core.fromGrameneNeighborhood;
/** @deprecated Import `computePivotState` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const computePivotState: typeof core.computePivotState = core.computePivotState;
/** @deprecated Import `computeVisibleRows` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const computeVisibleRows: typeof core.computeVisibleRows = core.computeVisibleRows;
/** @deprecated Import `LEAF_ROW_HEIGHT` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const LEAF_ROW_HEIGHT: typeof core.LEAF_ROW_HEIGHT = core.LEAF_ROW_HEIGHT;
/** @deprecated Import `SUMMARY_ROW_HEIGHT` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const SUMMARY_ROW_HEIGHT: typeof core.SUMMARY_ROW_HEIGHT = core.SUMMARY_ROW_HEIGHT;
/** @deprecated Import `computeRowRange` from 'tbrowse-core'. Removed in tbrowse 3.0. */
export const computeRowRange: typeof core.computeRowRange = core.computeRowRange;

export type {
  FromEnsemblOptions,
  FromEnsemblResult,
  FromEnsemblProteinFeaturesOptions,
  FromGrameneGeneResult,
  FromGrameneGenetreeOptions,
  FromGrameneGenetreeResult,
  PivotState,
} from 'tbrowse-core';

export { createStubZone } from './zones/stub';
// Editable zone-name control, so host-defined zones can offer the same
// rename affordance as the built-in zones.
export { EditableZoneName, type EditableZoneNameProps } from './zones/EditableZoneName';
// Row prologue for host-defined zones: hover/selection flags → theme background.
export { rowHighlightBackground, rowsWithFlags } from './zones/rows';
export {
  treeZone,
  type TreeZoneState,
  type PrunedNodeStyle,
} from './zones/tree/Tree';
export { labelsZone, type LabelsZoneState } from './zones/labels/Labels';
export { msaZone, type MSAZoneState } from './zones/msa/MSA';
export {
  neighborhoodZone,
  type NeighborhoodZoneState,
} from './zones/neighborhood/Neighborhood';
export {
  createGenomeZone,
  type GenomeZoneState,
  type CreateGenomeZoneOptions,
} from './zones/genome/Genome';
export {
  createTableZone,
  defaultAggregators,
  AGGREGATE_METHODS,
  DEFAULT_METHOD_ID,
  methodForKind,
  type TableZoneState,
  type TableData,
  type TableColumn,
  type TableColumnOverride,
  type TableCellValue,
  type TableDisplayMode,
  type CreateTableZoneOptions,
  type AggregateContext,
  type AggregateResult,
  type AggregateFn,
  type ColumnKind,
} from './zones/table/Table';
export {
  PALETTES,
  DEFAULT_SEQUENTIAL_PALETTE,
  DEFAULT_DIVERGING_PALETTE,
  type Palette,
  type PaletteKind,
} from './zones/table/heatmap';
export {
  COLOR_SCHEMES,
  defaultSchemeFor,
  applicableSchemes,
  type ColorScheme,
  type ColorSchemeId,
} from './zones/msa/coloring';
export {
  builtInFields,
  providerFields,
  allFields,
  type LabelField,
  type BuiltinLabelField,
  type ProviderLabelField,
} from './zones/labels/fields';
export {
  BUILTIN_SEARCH_FIELDS,
  compileStringMatcher,
  type SearchField,
  type SearchPredicateOptions,
  type MatchSpan,
} from './search/fields';
export { resolveMatches } from './search/resolveMatches';
export type {
  NodeId,
  GeneId,
  TaxonomyId,
  TreeNode,
  Tree,
  TaxonomyNode,
  Taxonomy,
  MSA,
  GeneMetadata,
  NodeAnnotation,
  ProteinDomain,
  Neighborhood,
  NeighborhoodGene,
  Exon,
  Transcript,
  GeneStructure,
  GenomeFeature,
  Germplasm,
  VariantSite,
  GenotypeMatrix,
  LabelProvider,
  ZoneViewState,
  SearchState,
  SearchResults,
  MSAViewState,
  LabelsViewState,
  ViewState,
  VisibleRow,
  RowRange,
  HostData,
  HostDataPatch,
  ZoneStatus,
  ZoneStatusMap,
  ZoneSpec,
  ZoneRenderProps,
  ZoneDefinition,
  TBrowseProps,
} from './types';
export { SEARCH_MATCH_LIMIT } from './types';
