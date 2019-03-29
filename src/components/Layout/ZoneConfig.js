import React from 'react'
import { connect } from 'react-redux'
import { addZone, deleteZone, replaceZone } from "../../reducers/Layout";
import { bindActionCreators } from 'redux'
import './style.css'

const SettingsButton = (props) => {
  return <button><i className="fas fa-cog"/></button>
};

const ZoneConfig = ({type,id,availableZones,addZone,deleteZone,replaceZone}) => (
  <div className='tbrowse-zone-config'>
    <select value={type} onChange={(e) => {
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
