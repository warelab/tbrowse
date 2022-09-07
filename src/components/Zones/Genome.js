import React from 'react'
import { connect } from 'react-redux'
import myContext from "../../store/context";
import {Loading} from "./Loading";
import './Genome.css';
import { mergeOverlaps } from "../../utils/treeTools";
import { fetchEnsemblFeaturesIfNeeded} from "../../actions/EnsemblRESTAPI";
import { remap } from "gramene-gene-positions";
import {bindActionCreators} from "redux";
import {fetchOrthologsIfNeeded} from "../../actions/Blastologs";
import {hoverNode} from "../../actions/Genetrees";

const Region = ({node, upstream, downstream}) => {
  // const regions = node.gene_structure.exons.map(e => {
  //   return {
  //     start: e.start,
  //     end: e.end,
  //     coverage: 1
  //   }
  // });
  // const merged = mergeOverlaps(regions, 1, 'sumd');
  const up_site = remap(node, upstream.position, upstream.level,'genome');
  const down_site = remap(node, downstream.position, downstream.level,'genome');
  const strand = node.gene_structure.location.strand;
  let location = {
    region: node.geneRegion,
    strand: strand
  };
  if (strand === 1) {
    location.from = up_site - upstream.distance;
    location.to = down_site + downstream.distance;
  }
  else {
    location.to = up_site + upstream.distance;
    location.from = down_site - downstream.distance;
  }
  console.log(location);
  return <div>{`${location.region}:${strand}:${location.from}-${location.to}`}</div>
};

const Genome = props => {
  if (props.nodes) {
    console.log(props);
    return (
      <div className='genome-zone' style={{width:props.width}}>
        {props.nodes.map((n,idx) => {
          let style = {};
          return n.gene_structure
            ? <Region key={idx} node={n} upstream={props.upstream} downstream={props.downstream} />
            : <div style={style} key={idx}>-</div>
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
    const features = state.genome;
    return { nodes, features, ...zone }
  }
  return { ...zone }
};

const mapDispatch = dispatch => bindActionCreators({ fetchEnsemblFeaturesIfNeeded }, dispatch);

export default connect(mapState, mapDispatch, null, {context:myContext})(Genome);
