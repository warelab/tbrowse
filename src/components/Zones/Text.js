import React from 'react'
import { connect } from 'react-redux'
import { hoverNode } from "../../actions/Genetrees";
import { bindActionCreators } from "redux";
import { BarLoader } from 'react-spinners';
import { css } from "@emotion/core";
import "react-toggle-switch/dist/css/switch.min.css";
import './Text.css';

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  if (state.genetrees.trees.hasOwnProperty(state.genetrees.currentTree)) {
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    const nodes = tree.visibleUnexpanded;
    const highlight = tree.highlight;
    return { nodes, highlight, ...zone }
  }
  return { ...zone }
};

const mapDispatch = dispatch => bindActionCreators({ hoverNode }, dispatch);


const nodeLabel = (node, props) => {
  let words = [];
  if (props.taxName) {
    words.push(node.taxonName);
  }
  if (props.geneName && (node.geneName || node.geneId)) {
    words.push(node.geneName || `[${node.geneId}]`);
  }
  return words.join(';');
};

const LabelsComponent = props => {
  if (props.nodes) {
    function onHover() { hoverNode(node.model.nodeId) }

    return (
      <div className='text-zone'>
        {props.nodes.map((n,idx) => {
          let style = {};
          if (props.highlight[n.model.nodeId]) style.fontWeight = 'bolder';
          return <div style={style}
                      key={idx}
                      onMouseOver={() => props.hoverNode(n.model.nodeId)}
          >{nodeLabel(n.model,props)}</div>
        })}
      </div>
    )
  }
  return (
    <div className='sweet-loading'>
      <BarLoader
        css={override}
        sizeUnit={"px"}
        size={props.width}
        color={'#123abc'}
        loading={!props.nodes}
      />
    </div>
  )
};

const DistancesComponent = props => {
  if (props.nodes) {
    return (
      <div className='text-zone'>
        {props.nodes.map((n,idx) => {
          return <div key={idx}>{n.model.distanceToParent}</div>
        })}
      </div>
    )
  }
  return (
    <div className='sweet-loading'>
      <BarLoader
        css={override}
        sizeUnit={"px"}
        size={props.width}
        color={'#123abc'}
        loading={!props.nodes}
      />
    </div>
  )
};

const Labels = connect(mapState, mapDispatch)(LabelsComponent);
const Distances = connect(mapState, mapDispatch)(DistancesComponent);

export { Labels, Distances };