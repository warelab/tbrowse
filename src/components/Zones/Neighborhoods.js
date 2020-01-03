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
  const st = state.genetrees.currentSpeciesTree;
  if (state.genetrees.trees.hasOwnProperty(treeUrl)
    && state.genetrees.neighbors.hasOwnProperty(url)
    && state.genetrees.trees.hasOwnProperty(st)) {
    let tree = state.genetrees.trees[treeUrl];
    reIndexTree(tree, ['geneId', 'nodeId']);
    const speciesTree = state.genetrees.trees[st];
    reIndexTree(speciesTree,['taxonId']);
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
        ...zone, nodes, highlight, neighbors, treeColor, zoneHeight, speciesTree
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
  const location = props.node.gene_structure.location;
  const stNode = props.speciesTree.indices.taxonId[props.node.taxonId];
  let tooltipFields = [
    ['region', location.region],
    ['start', location.start],
    ['end', location.end]
  ];
  const tooltip = (
    <Tooltip id={location.region + ':' + location.start}>
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
  const arrowLength = 0.5;//16;
  const arrowHeight = props.highlight[props.node.nodeId] ? 7 : 5;
  const regionColor = stNode.regionColor[location.region] || 'lightgray';
  let lineStart = -11;
  let lineEnd = 11 - arrowLength;
  let tipX = 11;//props.width;
  let tailX = tipX - arrowLength;
  if (location.strand === -1) {
    lineStart = -11 + arrowLength;
    lineEnd = 11;//props.width;
    tipX = -11;//0;
    tailX = tipX + arrowLength;
  }
  const points = `${tipX},${midline} ${tailX},${midline + arrowHeight} ${tailX},${midline - arrowHeight}`;
  return (
    <g>
      <OverlayTrigger placement="left" overlay={tooltip} trigger='hover' rootClose={true}>
        <line
          x1={lineStart} y1={midline}
          x2={lineEnd} y2={midline}
          stroke={regionColor}
          strokeWidth={props.highlight[props.node.nodeId] ? 5 : 3}
          cursor='pointer'
        />
      </OverlayTrigger>
      <polygon points={points}
               stroke='none'
               fill={regionColor}
      />
    </g>
  )
};
const Gene = props => {
  const strand = +props.gene.location.strand;
  const v = props.highlighted ? 1 : 0;
  const x = props.xPos;
  const y = props.yPos;
  const d = strand * props.neighborhoodOrientation === -1
    ? `M ${x - .43} ${y} l .3 ${9+2*v} h .5 v -${18+2*v} h -.5 Z`
    : `M ${x + .43} ${y} l -.3 ${9+2*v} h -.5 v -${18+2*v} h .5 Z`;
  return <path d={d} fill={props.color} stroke="none"/>;
};

const Neighbors = props => {
  const geneRank = props.node.geneRank[0];
  const strand = props.node.gene_structure.location.strand;
  return (
    <g onMouseOver={() => props.hoverNode(props.node.nodeId)}>
      <RegionArrow {...props}/>
      {props.node.geneNeighbors.map(neighborRank => {
        const neighbor = props.neighbors[neighborRank];
        const color = props.treeColor.scale(props.treeColor.treeMap[neighbor.treeId]) || 'grey';
        return <Gene key={neighborRank} neighborhoodOrientation={strand}
                     xPos={strand * (neighborRank - geneRank)}
                     yPos={props.node.displayInfo.offset + props.node.displayInfo.height / 2}
                     color={color} highlighted={!!props.highlight[props.node.nodeId]}
                     gene={neighbor} />
      })}
    </g>
  )
};

const Neighborhoods = props => {
  props.fetchNeighborsIfNeeded({});
  if (props.neighbors && props.treeColor) {
    return (
      <svg width={props.width}
           height={props.zoneHeight}
           viewBox={[-11,0,22,props.zoneHeight]}
           preserveAspectRatio='none'
           style={{position:'absolute',top:'90px',background:'white'}}
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
