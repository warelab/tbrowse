import React, {Component} from 'react'
import {render} from 'react-dom'
import TBrowse from '../../src'
import parse from 'url-parse'

const url = parse(document.location.href, true);
const props = {
  setId: url.query.setId || "compara_plants_98a",
  treeId: url.query.treeId || "EPlGT00940000167757",
  genesOfInterest: ['AT2G34710'],
  zones: [{
    type: 'tree',
    width: 300
  },{
    type: 'taxonomy'
  },{
    type: 'msa',
    colorScheme: 'clustal',
    width: 800
  },{
    type: 'label',
    taxName: false,
    geneName: true,
    width: 170
  }]
};
const propsPruned = {
  setId: url.query.setId || "compara_plants_98a",
  treeId: url.query.treeId || "EPlGT00940000167757",
  filter: 'taxonAncestors:3700',
  genesOfInterest: ['AT2G34710'],
  zones: [{
    type: 'tree',
    width: 300
  },{
    type: 'taxonomy'
  },{
    type: 'msa',
    colorScheme: 'clustal',
    width: 800
  },{
    type: 'label',
    taxName: false,
    geneName: true,
    width: 170
  }]
};

const props2 = {
  setId: url.query.setId || "compara_95",
  treeId: url.query.treeId || "ENSGT00950000183153",
  genesOfInterest: ['ENSG00000141510'],
  zones: [{
    type: 'tree'
  },{
    type: 'label'
  },{
    type: 'msa',
    colorScheme: 'clustal'
  }]
};

class Demo extends Component {
  render() {
    return <div>
      <h1>PHA</h1>
      <TBrowse {...props}/>
      <h1>PHA pruned to Brassicaceae</h1>
      <TBrowse {...propsPruned}/>
    </div>
  }
}

render(<Demo/>, document.querySelector('#demo'))
