import React from 'react'
import { connect } from 'react-redux'
import { addZone, deleteZone, replaceZone } from "../../reducers/Layout";
import { bindActionCreators } from 'redux'
import {components, configs} from '../inventory'
import './style.css'


class ZoneConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showConfig: false
    }
  }
  toggleConfig() {
    const showConfig = !this.state.showConfig;
    this.setState({showConfig});
  }
  render() {
    const zone = this.props.zone;
    const id = this.props.id;
    const addZone = this.props.addZone;
    const deleteZone = this.props.deleteZone;
    const replaceZone = this.props.replaceZone;

    return (
      <div className='tbrowse-zone-config'>
        <select style={{width: '100px'}} value={zone.type} onChange={(e) => {
          if (e.target.value === '__add') {
            addZone({idx: id})
          }
          else if (e.target.value === '__delete') {
            deleteZone({idx: id})
          }
          else {
            replaceZone({idx: id, type: e.target.value})
          }
        }}>
          <option value='tbd'>Choose...</option>
          <optgroup label={"Display Modes"}>
            {this.props.availableZones.map((aZone, idx) =>
              <option key={idx} value={aZone.type}>{aZone.label}</option>
            )}
          </optgroup>
          <optgroup label="Actions">
            <option value="__add">Add</option>
            {id > 0 && <option value="__delete">Delete</option>}
          </optgroup>
        </select>
        {zone.configurable && <a onClick={() => this.toggleConfig()}><i style={{float:'right'}} className="fa fa-cog"/></a>}
        {this.state.showConfig && React.createElement(configs[zone.type], this.props)}
      </div>
    );
  }
}


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.id];
  return {
    availableZones: state.layout.availableZones,
    id: ownProps.id,
    zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ addZone, deleteZone, replaceZone }, dispatch);

export default connect(mapState, mapDispatch)(ZoneConfig);
