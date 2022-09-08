import React from 'react'
import { connect } from 'react-redux'
import './Layout/style.css'
import Zone from './Layout/Zone'
import myContext from '../store/context'
import {components} from "./inventory";

const Layout = (props) => (
  <div className='tbrowse' style={{height:props.height}}>
    <div className='tbrowse-zone-headers'>
      { props.zones.map((zone, idx) => <Zone key={zone.type+idx} id={idx} showHeaders={true}/> ) }
    </div>
    <div className='tbrowse-zone-bodies'>
      { props.zones.map((zone, idx) => <Zone key={zone.type+idx} id={idx}/> ) }
    </div>
  </div>
);

export default connect(state => {
  let height = 94;
  if (state.genetrees.trees.hasOwnProperty(state.genetrees.currentTree)) {
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    const nodes = tree.nodes;
    tree.visibleUnexpanded.forEach(n => {
      height += nodes[n].displayInfo.height
    });
  }
  return {...state.layout, height}
},null,null,{context:myContext})(Layout);
