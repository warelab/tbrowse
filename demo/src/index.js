import React, {Component} from 'react'
import {render} from 'react-dom'
import TBrowse from '../../src'
import parse from 'url-parse'

const url = parse(document.location.href, true);
const props = {
  setId: url.query.setId || "compara_95",
  treeId: url.query.treeId || "ENSGT00390000003602",
  zones: [{
    type: 'tree',
    genesOfInterest: ['ENSG00000139618']
  },{
    type: 'label'
  },{
    type: 'msa',
    colorScheme: 'zappo'
  }]
};

class Demo extends Component {
  render() {
    return <div>
      <h1>tbrowse Demo</h1>
      <TBrowse {...props}/>
      <h1>tbrowse Demo 2</h1>
      <TBrowse {...props}/>
    </div>
  }
}

render(<Demo/>, document.querySelector('#demo'))
