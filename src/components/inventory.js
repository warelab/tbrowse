import Checkboxes from './Zones/Checkboxes'
import LocalData from './Zones/LocalData'
import MSA from './Zones/MSA'
import Neighborhoods from './Zones/Neighborhoods'
import { Labels, Distances, Taxonomy, Location } from './Zones/Text'
import Tree from './Zones/Tree'

export const components = {
  checkbox: Checkboxes,
  tree: Tree,
  msa: MSA,
  neighborhood: Neighborhoods,
  local: LocalData,
  label: Labels,
  distance: Distances,
  taxonomy: Taxonomy,
  location: Location
};
