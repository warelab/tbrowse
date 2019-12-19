import React from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from "redux";
import { fetchNeighborsIfNeeded, colorNeighborsIfNeeded, hoverNode } from "../../actions/Genetrees";
import { Loading } from './Loading';
import {reIndexTree} from "../../../es/utils/treeTools";
import {Tooltip, OverlayTrigger} from 'react-bootstrap';
import '../../scss/Custom.scss';


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  const url = state.genetrees.currentNeighbors;
  const treeUrl = state.genetrees.currentTree;
  if (state.genetrees.trees.hasOwnProperty(treeUrl) && state.genetrees.neighbors.hasOwnProperty(url)) {
    let tree = state.genetrees.trees[treeUrl];
    reIndexTree(tree, ['geneId', 'nodeId']);
    const goi = tree.indices.geneId[state.genetrees.genesOfInterest[0]];
    const nodes = tree.visibleUnexpanded;
    const highlight = tree.highlight;
    const neighbors = state.genetrees.neighbors[url];
    if (state.genetrees.treeColors[goi.geneId]) {
      const treeColor = state.genetrees.treeColors[goi.geneId];
      let zoneHeight=0;
      nodes.forEach(n => {
        n.displayInfo.offset = zoneHeight;
        zoneHeight += n.displayInfo.height
      });
      return {
        ...zone, nodes, highlight, neighbors, treeColor, zoneHeight
      }
    }
    return {
      ...zone, nodes, highlight, neighbors
    }
  }
  return {
    ...zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ fetchNeighborsIfNeeded, colorNeighborsIfNeeded, hoverNode }, dispatch);

const RegionArrow = props => {
  const midline = props.node.displayInfo.offset + props.node.displayInfo.height / 2;
  const region = {
    name: 'yes',
    start: 1,
    end: 10
  };
  let tooltipFields = [
    ['region', region.name],
    ['start', region.start],
    ['end', region.end]
  ];
  const tooltip = (
    <Tooltip id={region.name + ':' + region.start}>
      <table>
        <tbody>
        {tooltipFields.map( (tip, i ) => {
          return (
            <tr key = {i} style={{verticalAlign : 'top'}}>
              <th>{tip[0]}</th>
              <td style={{color : 'lightgray', textAlign : 'left', paddingLeft : '15px'}}>{tip[1]}</td>
            </tr>
          )
        })}
        </tbody>
      </table>
    </Tooltip>
  );
  return (
    <OverlayTrigger placement="left" overlay={tooltip} trigger='click' rootClose={true}>
      <line
        x1={0} y1={midline}
        x2={props.width} y2={midline}
        stroke='blue'
        strokeWidth={props.highlight[props.node.nodeId] ? 5 : 3}
        cursor='pointer'
      />
    </OverlayTrigger>
  )
};

const Neighbors = props => {
  return (
    <g onMouseOver={() => props.hoverNode(props.node.nodeId)}>
      <RegionArrow {...props}/>
    </g>
  )
};

const Neighborhoods = props => {
  props.fetchNeighborsIfNeeded({});
  if (props.neighbors && props.treeColor) {
    return (
      <svg width={props.width}
           height={props.zoneHeight}
           style={{position:'absolute',top:'90px',background:'palegreen'}}
      >
        { props.nodes.filter(n => n.hasOwnProperty('geneId')).map((n,idx) => <Neighbors key={idx} node={n} {...props} />) }
      </svg>
    )
  }
  else {
    if (props.neighbors) {
      props.colorNeighborsIfNeeded();
    }
    return (
      <Loading {...props} isLoading={true}/>
    )
  }
};

export default connect(mapState, mapDispatch)(Neighborhoods);
