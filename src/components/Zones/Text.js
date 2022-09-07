import React from 'react'
import { connect } from 'react-redux'
import myContext from '../../store/context'
import { hoverNode } from "../../actions/Genetrees";
import { bindActionCreators } from "redux";
import "react-toggle-switch/dist/css/switch.min.css";
import './Text.css';
import { Loading } from './Loading';

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
  if (props.geneId) {
    if (node.geneId) {
      words.push(node.geneId)
    }
    else {
      words.push('--')
    }
  }
  return words.join(';');
};

const LabelsComponent = props => {
  if (props.header) { return null; }
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
  if (props.header) { return null; }
  if (props.nodes) {
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

const getLocation = node => {
  if (node.gene_structure) {
    const l = node.gene_structure.location;
    const s = l.strand === -1 ? '-' : '+';
    return `${l.region}:${s}:${l.start}-${l.end}`;
  }
  return '--';
};

const LocationComponent = props => {
  if (props.header) { return null; }
  if (props.nodes) {
    return (
      <div className='text-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          let style = {};
          if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
          return <div style={style}
                      key={idx}
                      onMouseOver={() => props.hoverNode(n.nodeId)}
          >{getLocation(n)}</div>
        })}
      </div>
    )
  }
  return <Loading {...props}/>
};

const DistancesComponent = props => {
  if (props.header) { return null; }
  if (props.nodes) {
    return (
      <div className='text-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          let style = {};
          if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
          return <div style={style}
                      key={idx}
                      onMouseOver={() => props.hoverNode(n.nodeId)}
          >{n.distanceToParent}</div>
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
    return { nodes, highlight, ...zone, isLoading:false }
  }
  return { ...zone, isLoading:true }
};

const mapDispatch = dispatch => bindActionCreators({ hoverNode }, dispatch);

const Labels = connect(mapState, mapDispatch, null, {context:myContext})(LabelsComponent);
const Distances = connect(mapState, mapDispatch, null, {context:myContext})(DistancesComponent);
const Taxonomy = connect(mapState, mapDispatch, null, {context:myContext})(TaxonomyComponent);
const Location = connect(mapState, mapDispatch, null, {context:myContext})(LocationComponent);

export { Labels, Distances, Taxonomy, Location };