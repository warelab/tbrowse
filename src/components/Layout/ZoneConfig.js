import React from 'react'
import { connect } from 'react-redux'
import { addZone, deleteZone, replaceZone, updateZoneParam } from "../../reducers/Layout";
import { bindActionCreators } from 'redux'
import './style.css'
import 'rc-slider/assets/index.css'
import 'rc-tooltip/assets/bootstrap.css';
import Slider from 'rc-slider'
import Switch from 'react-toggle-switch';
import Tooltip from 'rc-tooltip';
const Handle = Slider.Handle;

const handle = (props) => {
  const { value, dragging, index, ...restProps } = props;
  return (
    <Tooltip
      prefixCls="rc-slider-tooltip"
      overlay={value}
      visible={dragging}
      placement="top"
      key={index}
    >
      <Handle value={value} {...restProps} />
    </Tooltip>
  );
};

const ConfigurableParameter = ({param, value, onUpdate, extraArgs}) => {
  if (param.type === 'integer') {
    return (
      <tr>
        <td>{param.label}</td>
        <td>
          <Slider min={param.min} max={param.max} defaultValue={value} handle={handle}
                  onAfterChange={(x)=>onUpdate({...extraArgs, id: param.id, value:x})}/>
        </td>
      </tr>
    )
  }
  else if (param.type === 'enum') {
    return (
      <tr>
        <td>{param.label}</td>
        <td><select value={value} onChange={(e)=>onUpdate({...extraArgs, id: param.id, value:e.target.value})}>
          {param.values.map((v,idx) => <option value={v.id} key={idx}>{v.label}</option>)}
        </select></td>
      </tr>
    )
  }
  else if (param.type === 'bool') {
    return (
      <tr>
        <td>{param.label}</td>
        <td style={{transform:'scale(0.6)'}}>
          <Switch onClick={(e)=>onUpdate({...extraArgs, id: param.id, value:!value})} on={value || false}/>
        </td>
      </tr>
    )
  }
};

class ZoneConfig extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      showConfig: false
    }
  }
  toggleConfig() {
    this.setState(prevState => ({
      showConfig: !prevState.showConfig
    }))
  }
  render() {
    const zone = this.props.zone;
    const id = this.props.id;
    const addZone = this.props.addZone;
    const deleteZone = this.props.deleteZone;
    const replaceZone = this.props.replaceZone;
    const updateParam = this.props.updateZoneParam;

    return (
      <div className='tbrowse-zone-config'>
        <select style={{width: `${Math.min(zone.width,200) - 40}px`}} value={zone.type} onChange={(e) => {
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
        {zone.configurable && <a onClick={() => this.toggleConfig()}><i style={{float:'right', fontSize:'22px', fontWeight: this.state.showConfig ? 'bolder' : 'normal'}} className="fa fa-cog"/></a>}
        {this.state.showConfig &&
          <div className='tbrowse-param-table-wrapper'>
            <table className='tbrowse-param-table'>
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {zone.configurable.map((p,idx) => <ConfigurableParameter key={idx}
                                                                         param={p}
                                                                         value={zone[p.id]}
                                                                         onUpdate={updateParam}
                                                                         extraArgs={{idx:id}}
                                                                         />)}
              </tbody>
            </table>
          </div>
        }
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

const mapDispatch = dispatch => bindActionCreators({ addZone, deleteZone, replaceZone, updateZoneParam }, dispatch);

export default connect(mapState, mapDispatch)(ZoneConfig);
