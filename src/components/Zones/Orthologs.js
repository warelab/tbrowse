import React from 'react'
import { connect } from 'react-redux'
import { bindActionCreators } from "redux";
import { fetchOrthologsIfNeeded } from "../../actions/Blastologs";
import { hoverNode } from "../../actions/Genetrees";
import { Loading } from './Loading';

const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  const url = state.genetrees.currentTree;
  const st = state.genetrees.currentSpeciesTree;
  const goi = state.genetrees.genesOfInterest[0];
  if (state.genetrees.trees.hasOwnProperty(url) && state.genetrees.trees.hasOwnProperty(st)) {
    const tree = state.genetrees.trees[url];
    const speciesTree = state.genetrees.trees[st];
    const nodes = tree.visibleUnexpanded;
    const highlight = tree.highlight;
    const orthologs = state.blastologs;
    return {
      ...zone, nodes, highlight, speciesTree, orthologs, goi
    }
  }
  return {
    ...zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ fetchOrthologsIfNeeded, hoverNode }, dispatch);

const getOrthologs = (node, props) => {
  if (props.orthologs.hasOwnProperty(node.geneId)) {
    if (!props.orthologs[node.geneId].orthologs) {
      return props.orthologs[node.geneId].status;
    }
    let taxonTally=[];
    for(let i=0;i<props.speciesTree.leafCount;i++) {
      taxonTally[i]=0;
    }
    props.orthologs[node.geneId].orthologs.forEach(o => {
      const tid = props.orthologs[o].taxon_id;
      taxonTally[props.speciesTree.leafOrder[tid]]++;
    });
    return taxonTally.join(' '); // todo: use the heatmap font?
  }
  else {
    props.fetchOrthologsIfNeeded(node.geneId); // todo: this can trigger many redundant ajax, but fix elsewhere
    return <Loading {...props} isLoading={true}/>
  }
};

const Orthologs = props => {
  props.fetchOrthologsIfNeeded(props.goi);
  if (props.nodes) { // todo: make the header show the species tree leaf nodes markers, hover to show taxon name
    // render the species tree in the header (is this feasible?)
    return (
      <div>
        <div>{JSON.stringify(props.speciesTree.leafOrder)}</div>
        <div className='text-zone'>
          {props.nodes.map((n,idx) => {
            let style = {};
            if (props.highlight[n.nodeId]) style.fontWeight = 'bolder';
            return <div style={style} key={idx}
                        onMouseOver={() => props.hoverNode(n.nodeId)}
            >{n.nodeType === 'coding' ? getOrthologs(n,props) : '--'}</div>
         })}
        </div>
      </div>
    )
  }
  else {
    return (
      <Loading {...props} isLoading={true}/>
    )
  }
};

export default connect(mapState, mapDispatch)(Orthologs);
