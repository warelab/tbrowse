import React, {Component} from 'react'
import {render} from 'react-dom'

import TBrowse from '../../src'

class Demo extends Component {
  render() {
    return <div>
      <h1>tbrowse Demo</h1>
      <TBrowse/>
    </div>
  }
}

render(<Demo/>, document.querySelector('#demo'))
