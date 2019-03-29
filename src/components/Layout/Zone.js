import React from 'react'
import { updateZonePosition } from "../../reducers/Layout"
import { bindActionCreators } from 'redux'
import reactable from 'reactablejs'
import {connect} from "react-redux"
import ZoneConfig from './ZoneConfig'
import components from '../inventory'
import './style.css'

const Child = props => (
  <div id={props.zoneId}
       className={`zone-cfg`}
       style={{width: props.width, left: props.x}}
       ref={props.getRef}
  >
    <ZoneConfig id={props.zoneId}/>
    {props.zoneType && components[props.zoneType] && React.createElement(components[props.zoneType])}
  </div>
);

const ReactableChild = reactable(Child);

class Zone extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      width: props.initialWidth,
      x: props.initialOffset
    }
  }
  handleDragMove = (e) => {
    this.setState(state => ({
      x: state.x + e.dx
    }))
  };
  handleResizeMove = (e) => {
    this.setState(state => {
      return {
        x: state.x + e.deltaRect.left,
        width: e.rect.width
      }
    })
  };
  handleEnd = (e) => {
    this.props.updateZonePosition({
      idx: e.target.id,
      offset:this.state.x,
      width: this.state.width
    })
  };
  render() {
    return (
      <ReactableChild
        draggable
        resizable={{
          edges: { left: true, right: true}
        }}
        onDragMove={this.handleDragMove}
        onResizeMove={this.handleResizeMove}
        onDragEnd={this.handleEnd}
        onResizeEnd={this.handleEnd}
        zoneId={this.props.id}
        zoneType={this.props.type}
        {...this.state}
      />
    )
  }
}

const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.id];
  return {
    id: ownProps.id,
    type: zone.type,
    initialWidth: zone.width,
    initialOffset: zone.offset,
  }
};

const mapDispatch = dispatch => bindActionCreators({ updateZonePosition }, dispatch);

export default connect(mapState, mapDispatch)(Zone);
