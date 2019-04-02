import React from 'react'
import { connect } from 'react-redux'
import { addZone, deleteZone, replaceZone } from "../../reducers/Layout";
import { bindActionCreators } from 'redux'
import './style.css'

const SettingsButton = (props) => {
  if (props.configurable) {
    return <i style={{float:'right'}} className="fa fa-cog"/>
  }
  return null
};

const ZoneConfig = ({type,id,availableZones,addZone,deleteZone,replaceZone}) => (
  <div className='tbrowse-zone-config'>
    <select style={{width:'100px'}} value={type} onChange={(e) => {
      if (e.target.value === '__add') {
        addZone({idx:id})
      }
      else if (e.target.value === '__delete') {
        deleteZone({idx:id})
      }
      else {
        replaceZone({idx: id, type: e.target.value})
      }
    }}>
      <option value='tbd'>Choose...</option>
      <optgroup label={"Display Modes"}>
        {availableZones.map((zone,idx) =>
          <option key={idx} value={zone.type}>{zone.label}</option>
        )}
      </optgroup>
      <optgroup label="Actions">
        <option value="__add">Add</option>
        {id > 0 && <option value="__delete">Delete</option>}
      </optgroup>
    </select>
    <SettingsButton id={id}/>
  </div>
);


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.id];
  return {
    availableZones: state.layout.availableZones,
    id: ownProps.id,
    type: zone.type
  }
};

const mapDispatch = dispatch => bindActionCreators({ addZone, deleteZone, replaceZone }, dispatch);

export default connect(mapState, mapDispatch)(ZoneConfig);
