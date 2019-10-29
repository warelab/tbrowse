import React from 'react'
import { connect } from 'react-redux'
import './Layout/style.css'
import Zone from './Layout/Zone'

const Layout = (props) => (
  <div className='tbrowse' style={{height: props.height}}>
    { props.zones.map((zone, idx) => <Zone key={zone.type+idx} id={idx}/> ) }
  </div>
);

export default connect(state => {
  let height = 94;
  if (state.genetrees.trees.hasOwnProperty(state.genetrees.currentTree)) {
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    const nodes = tree.visibleUnexpanded;
    nodes.forEach(n => {
      height += n.displayInfo.height
    });
  }
  return {...state.layout, height}
})(Layout);
