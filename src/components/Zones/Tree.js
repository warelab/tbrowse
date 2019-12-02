import React from 'react'
import { connect } from 'react-redux'
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import {bindActionCreators} from "redux";
import {expandNode,collapseNode,hoverNode} from "../../actions/Genetrees";
import {reIndexTree} from "../../utils/treeTools";
import './Tree.css';

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

class Tree extends React.Component {
  constructor(props) {
    super(props);
  }
  render() {
    if (this.props.isFetching) {
      return (
        <div className='sweet-loading'>
          <BarLoader
            css={override}
            sizeUnit={"px"}
            size={this.props.width}
            color={'#123abc'}
            loading={this.props.isFetching}
          />
        </div>
      )
    }
    const xScale = (this.props.width - (this.props.nodeRadius + 1)) / this.props.tree.maxExpandedDist;
    return (
      <svg width={this.props.width}
           height={this.props.zoneHeight + 'px'}
           style={{position:'absolute',top:'90px'}}
      >
        {this.props.tree.visibleNodes.map((node,idx) => (
          <TreeNode key={idx} xScale={xScale} node={node} {...this.props}/>
        ))}
      </svg>
    )
  }
}


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  const url = state.genetrees.currentTree;
  if (state.genetrees.trees.hasOwnProperty(url)) {
    const tree = state.genetrees.trees[url];
    // need reference to parent node on each.
    const highlight = tree.highlight;
    reIndexTree(tree, ['geneId','nodeId']);
    const parentOf = tree.indices.parentOf;
    let zoneHeight=0;
    tree.visibleUnexpanded.forEach(n => {
      n.displayInfo.offset = zoneHeight;
      zoneHeight += n.displayInfo.height
    });
    return {
      isFetching: state.genetrees.isFetching, ...zone, tree, parentOf, highlight, zoneHeight
    }
  }
  return {
    isFetching: state.genetrees.isFetching,
    ...zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ expandNode, collapseNode, hoverNode }, dispatch);

export default connect(mapState, mapDispatch)(Tree);

const TreeNode = (props) => {
  const node = props.node;
  const xScale = props.xScale;
  const width = props.width;
  const height = node.displayInfo.height;
  const nodeRadius = props.nodeRadius;
  const highlight = props.highlight[node.nodeId];

  let marker,hline,vline,bbox,extension;
  let x=node.scaledDistanceToRoot * xScale;
  let y=(node.vindex-1) * height + height/2;
  const parent = props.parentOf[node.nodeId];
  let parentX = parent ? parent.scaledDistanceToRoot * xScale : 0;
  bbox = <rect x={parentX} y={y - height/2} width={x - parentX + nodeRadius} height={height} className='bbox'/>;
  if (node.scaleFactor !== 1) {
    hline = <line x1={parentX} y1={y} x2={x} y2={y} strokeDasharray="4, 4" className={`line${node.scaleFactor}`}/>;
  }
  else {
    hline = <line x1={parentX} y1={y} x2={x} y2={y} className={`line`}/>;
  }
  if (!node.children || node.children.length === 0) { // leaf
    marker = <circle cx={x} cy={y} r={nodeRadius} className={node.class}/>;
    extension = <line x1={x} x2={width} y1={y} y2={y} className='extension'/>;
    if (parent && parent.children.length === 2) {
      const parentX = parent.scaledDistanceToRoot * xScale;
      let parentY = (parent.vindex - 1) * height + height / 2;
      if (parentY < y) { parentY += nodeRadius }
      else { parentY -= nodeRadius }
      let vlineClass = highlight ? 'vline highlight' : 'vline';
      vline = <line x1={parentX} x2={parentX} y1={y} y2={parentY} className={vlineClass}/>;
    }
  }
  else {
    if (parent && parent.children.length === 2) {
      const parentX = parent.scaledDistanceToRoot * xScale;
      let parentY = (parent.vindex - 1) * height + height / 2;
      if (parentY < y) { parentY += nodeRadius }
      else { parentY -= nodeRadius }
      let vlineClass = highlight ? 'vline highlight' : 'vline';
      vline = <line x1={parentX} x2={parentX} y1={y} y2={parentY} className={vlineClass}/>;
    }
    if (node.displayInfo.expanded) {
      let w = nodeRadius*1.5;
      if (node.children.length === 2) { // internal
        let child1Y = (node.children[0].vindex - 1) * height + height / 2;
        let child2Y = (node.children[1].vindex - 1) * height + height / 2;
        bbox = <rect x={parentX} y={child1Y} width={x - parentX + nodeRadius} height={child2Y - child1Y} className='bbox'/>;
        marker = <rect x={x - w/2} y={y - w/2} width={w} height={w} className={node.class}/>;
        // vline = <line x1={x} x2={x} y1={child1Y} y2={child2Y} className='line'/>;
      }
      else { // pruned child
        w *= 0.3;
        if (parent && node.leftIndex - 1 === parent.leftIndex) {
          marker = <polygon points={`${x - w},${y} ${x},${y - 2 * w} ${x + 2 * w},${y - 2 * w} ${x + w},${y}`}
                            className={node.class}/>;
        }
        else {
          marker = <polygon points={`${x - w},${y} ${x},${y + 2 * w} ${x + 2 * w},${y + 2 * w} ${x + w},${y}`}
                            className={node.class}/>;
        }
      }
    }
    else { // collapsed
      marker = <polygon points={`${x},${y-0.4*height} ${x},${y+0.4*height} ${Math.max(parentX,x-4*nodeRadius)},${y}`}
                        className={node.class}/>;
      extension = <line x1={x} x2={width} y1={y} y2={y} className='extension'/>;
      // hline = null;
    }
  }
  const nodeClass = highlight ? 'tree-node highlight' : 'tree-node';

  const expandOrCollapse = node => {
    if (node.displayInfo.expanded) {
      props.collapseNode(node);
    }
    else {
      props.expandNode(node, true);
    }
  };

  return (
    <g className={nodeClass} onClick={()=>expandOrCollapse(node)} onMouseOver={()=>props.hoverNode(node.nodeId)}>
      {vline}
      {extension}
      {hline}
      {marker}
      {bbox}
    </g>
  )
};