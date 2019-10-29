import React, {Component} from 'react'
import {render} from 'react-dom'
import TBrowse from '../../src'
import parse from 'url-parse'

const url = parse(document.location.href, true);
const props = {
  setId: url.query.setId || "compara_plants_98",
  treeId: url.query.treeId || "EPlGT00940000164376",
  genesOfInterest: ['AT1G32900'],
  zones: [{
    type: 'tree'
  },{
    type: 'label'
  },{
    type: 'msa',
    colorScheme: 'clustal'
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
      <h1>Waxy</h1>
      <TBrowse {...props}/>
      <h1>Tp53</h1>
      <TBrowse {...props2}/>
    </div>
  }
}

render(<Demo/>, document.querySelector('#demo'))
