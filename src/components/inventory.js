import Checkboxes from './Checkboxes'
import LocalData from './LocalData'
import MSA from './MSA'
import Neighborhoods from './Neighborhoods'
import { Labels, Distances } from './Text'
import Tree from './Tree'

const components = {
  checkbox: Checkboxes,
  tree: Tree,
  msa: MSA,
  neighborhood: Neighborhoods,
  local: LocalData,
  label: Labels,
  distance: Distances
};

export default components;