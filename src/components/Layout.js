import React from 'react'
import { connect } from 'react-redux'
import './Layout/style.css'
import Zone from './Layout/Zone'

const Layout = (props) => (
  <div className='tbrowse'>
    { props.zones.map((zone, idx) => <Zone key={zone.type+idx} id={idx}/> ) }
  </div>
);

export default connect(state => state.layout)(Layout);
