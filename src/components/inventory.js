import Checkboxes from './Zones/Checkboxes'
import LocalData from './Zones/LocalData'
import MSA from './Zones/MSA'
import Neighborhoods from './Zones/Neighborhoods'
import Orthologs from './Zones/Orthologs'
import Genome from './Zones/Genome'
import { Labels, Distances, Taxonomy, Location } from './Zones/Text'
import { TreeHeader, TreeBody } from './Zones/Tree'

export const components = {
  checkbox: Checkboxes,
  tree: TreeBody,
  treeHeader: TreeHeader,
  msa: MSA,
  neighborhood: Neighborhoods,
  local: LocalData,
  label: Labels,
  distance: Distances,
  taxonomy: Taxonomy,
  location: Location,
  blastologs: Orthologs,
  genome: Genome
};
