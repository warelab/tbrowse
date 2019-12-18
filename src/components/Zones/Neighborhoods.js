import React from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from "redux";
import { fetchNeighborsIfNeeded, colorNeighborsIfNeeded, hoverNode } from "../../actions/Genetrees";
import { Loading } from './Loading';
import {reIndexTree} from "../../../es/utils/treeTools";


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
      return {
        ...zone, nodes, highlight, neighbors, treeColor
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

const Neighborhoods = props => {
  props.fetchNeighborsIfNeeded({});
  if (props.neighbors && props.treeColor) {
    return (
      <div>
        <div className='text-zone'>
          {props.nodes.map((n,idx) => {
            let style = {};
            if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
            return <div style={style} key={idx}
                        onMouseOver={() => props.hoverNode(n.nodeId)}
            >--</div>
          })}
        </div>
      </div>
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
