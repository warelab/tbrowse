import React from 'react'
import { updateZonePosition } from "../../reducers/Layout"
import { bindActionCreators } from 'redux'
import reactable from 'reactablejs'
import {connect} from "react-redux"
import ZoneConfig from './ZoneConfig'
import {components} from '../inventory'
import './style.css'
import myContext from '../../store/context'

const Child = props => (
  <div id={props.zoneId}
       className={`zone-cfg`}
       style={{width: props.width, left: props.x + props.zoneId*6}}
       ref={props.getRef}
  >
    <ZoneConfig id={props.zoneId}/>
    { props.header && components[props.zoneType+'Header'] && React.createElement(components[props.zoneType+'Header'], props) }
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
    if (e.rect.width > this.props.minWidth) {
      this.setState(state => {
        return {
          x: state.x + e.deltaRect.left,
          width: e.rect.width
        }
      })
    }
  };
  handleEnd = (e) => {
    this.props.updateZonePosition({
      idx: e.target.id,
      offset:this.state.x,
      width: this.state.width
    })
  };
  render() {
    if (this.props.showHeaders) {
      return (
        <ReactableChild
          // draggable
          resizable={{
            edges: { left: true, right: true}
          }}
          onDragMove={this.handleDragMove}
          onResizeMove={this.handleResizeMove}
          onDragEnd={this.handleEnd}
          onResizeEnd={this.handleEnd}
          zoneId={this.props.zoneId}
          zoneType={this.props.zoneType}
          header={this.props.zoneHeader}
          {...this.state}
        />
      )
    }
    return (
      <div className='tbrowse-zone-body' style={{width: this.props.initialWidth, left: this.props.initialOffset + this.props.id*10 }}>
        { this.props.zoneType && components[this.props.zoneType] && React.createElement(components[this.props.zoneType], this.props) }
      </div>
    )
  }
}

const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.id];
  return {
    zoneId: ownProps.id,
    showHeaders: ownProps.showHeaders,
    zoneType: zone.type,
    zoneHeader: zone.hasHeader,
    initialWidth: zone.width,
    initialOffset: zone.offset,
    minWidth: zone.minWidth || 100
  }
};

const mapDispatch = dispatch => bindActionCreators({ updateZonePosition }, dispatch);

export default connect(mapState, mapDispatch, null, {context:myContext})(Zone);
