/**
 * REST → model adapters. Every function here is pure: it takes the
 * decoded JSON body of one Ensembl or Gramene REST response and returns
 * the normalised tbrowse-core shapes (`Tree`, `Taxonomy`, `MSA`,
 * `GeneStructure`, ...). The host owns the network call, so these run
 * unchanged in a browser, in Node, or against recorded fixtures.
 *
 * Origin: moved verbatim from `tbrowse/src/adapters/{ensembl,gramene}.ts`.
 */
export {
  fromEnsemblGeneTree,
  fromEnsemblProteinFeatures,
  fromEnsemblGeneStructure,
  fromEnsemblGenomeFeatures,
} from './ensembl';
export type {
  FromEnsemblOptions,
  FromEnsemblResult,
  FromEnsemblProteinFeaturesOptions,
} from './ensembl';

export {
  fromGrameneGenetree,
  expandCigar,
  fromGrameneGene,
  fromGrameneNeighborhood,
  fromGrameneGeneStructures,
} from './gramene';
export type {
  FromGrameneGenetreeOptions,
  FromGrameneGenetreeResult,
  FromGrameneGeneResult,
} from './gramene';

export {
  fromBrAPIAlleleMatrix,
  fromBrAPIGermplasm,
  fromBrAPIVariants,
  mergeVariantSites,
  fromBrAPITree,
} from './brapi';
export type {
  FromBrAPIAlleleMatrixOptions,
  FromBrAPIAlleleMatrixResult,
  FromBrAPIVariantsOptions,
} from './brapi';
