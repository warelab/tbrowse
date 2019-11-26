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

const Loading = props => (
  <div className='sweet-loading'>
    <BarLoader
      css={override}
      sizeUnit={"px"}
      size={props.width}
      color={'#123abc'}
      loading={!props.nodes}
    />
  </div>
);

const nodeLabel = (node, props) => {
  let words = [];
  if (props.taxName) {
    words.push(node.taxonName);
  }
  if (props.geneName) {
    if (node.geneName || node.geneId) {
      words.push(node.geneName || `[${node.geneId}]`);
    }
    else {
      words.push('--')
    }
  }
  return words.join(';');
};

const LabelsComponent = props => {
  if (props.nodes) {
    function onHover() { props.hoverNode(node.nodeId) }

    return (
      <div className='text-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          let style = {};
          if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
          return <div style={style}
                      key={idx}
                      onMouseOver={() => props.hoverNode(n.nodeId)}
          >{nodeLabel(n,props)}</div>
        })}
      </div>
    )
  }
  return <Loading {...props}/>;
};

const TaxonomyComponent = props => {
  if (props.nodes) {
    function onHover() { props.hoverNode(node.nodeId) }

    return (
      <div className='text-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          let style = {};
          if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
          return <div style={style}
                      key={idx}
                      onMouseOver={() => props.hoverNode(n.nodeId)}
          >{n.taxonName}</div>
        })}
      </div>
    )
  }
  return <Loading {...props}/>
};

const DistancesComponent = props => {
  if (props.nodes) {
    return (
      <div className='text-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          return <div key={idx}>{n.distanceToParent}</div>
        })}
      </div>
    )
  }
  return <Loading {...props}/>;
};

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

const Labels = connect(mapState, mapDispatch)(LabelsComponent);
const Distances = connect(mapState, mapDispatch)(DistancesComponent);
const Taxonomy = connect(mapState, mapDispatch)(TaxonomyComponent);

export { Labels, Distances, Taxonomy };