import Checkboxes from './Zones/Checkboxes'
import LocalData from './Zones/LocalData'
import { MSA, MSAConfig } from './Zones/MSA'
import Neighborhoods from './Zones/Neighborhoods'
import { Labels, Distances } from './Zones/Text'
import Tree from './Zones/Tree'

export const components = {
  checkbox: Checkboxes,
  tree: Tree,
  msa: MSA,
  neighborhood: Neighborhoods,
  local: LocalData,
  label: Labels,
  distance: Distances
};

export const configs = {
  msa: MSAConfig
};