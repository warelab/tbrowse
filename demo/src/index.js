import React, {Component} from 'react'
import {render} from 'react-dom'
import TBrowse from '../../src'
import parse from 'url-parse'

const url = parse(document.location.href, true);
const props = {
  setId: url.query.setId || "compara_plants_98",
  treeId: url.query.treeId || "EPlGT00940000167757",
  genesOfInterest: ['AT2G34710'],
  zones: [{
    type: 'tree',
    width: 300
  },{
    type: 'taxonomy'
  },{
    type: 'neighborhood',
    width: 800
  },{
    type: 'label',
    taxName: false,
    geneName: true,
    width: 170
  }]
};
const propsPruned = {
  setId: url.query.setId || "compara_plants_98",
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
    width: 800,
    minDepth: 1
  },{
    type: 'label',
    taxName: false,
    geneName: true,
    width: 170
  }]
};

const props2 = {
  setId: url.query.setId || "sorghum4",
  treeId: url.query.treeId || "SORGHUM4GT_203438",
  filter: url.query.filter || "*:*", //'taxonAncestors:1000655996',
  genesOfInterest: url.query.goi ? [url.query.goi] : ['SORBI_3001G125900'],
  zones: [{
    type: 'tree'
  },{
    type: 'taxonomy'
  },{
    type: 'msa',
    colorScheme: 'clustal',
    minDepth: 10,
    width: 800
  },{
    type: 'neighborhood'
  }]
};

class Demo extends Component {
  render() {
    return <div>
      {/*<h1>PHA</h1>*/}
      <TBrowse {...props2}/>
      {/*<h1>PHA pruned to Brassicaceae</h1>*/}
      {/*<TBrowse {...propsPruned}/>*/}
    </div>
  }
}

render(<Demo/>, document.querySelector('#demo'))
