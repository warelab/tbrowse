import React from 'react'
import { connect } from 'react-redux'
import myContext from '../../store/context'
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import {bindActionCreators} from "redux";
import {expandNode,collapseNode,swapChildren,updateGenesOfInterest,hoverNode} from "../../actions/Genetrees";
import {reIndexTree} from "../../utils/treeTools";
import './Tree.css';
import {OverlayTrigger, Popover} from "react-bootstrap";

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

const NodeInfo = ({node}) => {
  return <div className='nodeinfo'>
    <table><tbody>
      <tr><th>Taxonomy Node</th><td>{node.taxonName}</td></tr>
      { node.nodeType === 'protein_coding'
        ? <tr><th>Gene Id</th><td>{node.geneId}</td></tr>
        : <tr><th>Node Type</th><td>{node.nodeType}</td></tr>
      }
      { node.nodeType === 'protein_coding' && node.geneName && <tr><th>Gene Name</th><td>{node.geneName}</td></tr> }
    </tbody></table>
  </div>
};

class Tree extends React.Component {
  constructor(props) {
    super(props);
  }
  render() {
    if (!this.props.tree) {
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
    if (this.props.header) {
      return (
        <div className='zone-header'>
          {this.props.tree.hoveredNodeId &&
            <NodeInfo node={this.props.tree.nodes[this.props.tree.hoveredNodeId]}/>}
        </div>
      )
    }
    return (
      <div>
        <svg width={this.props.width}
             height={this.props.zoneHeight + 'px'}
             style={{position:'absolute'}}
        >
          {this.props.tree.visibleNodes.map((nodeId,idx) => (
            <TreeNode key={idx} xScale={xScale} node={this.props.tree.nodes[nodeId]} {...this.props}/>
          ))}
        </svg>
      </div>
    )
  }
}


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  const url = state.genetrees.currentTree;
  const st = state.genetrees.currentSpeciesTree;
  const goi = state.genetrees.genesOfInterest[0];
  const header = !!ownProps.header;
  if (state.genetrees.trees.hasOwnProperty(url) && state.genetrees.trees.hasOwnProperty(st)) {
    const tree = state.genetrees.trees[url];
    const speciesTree = state.genetrees.trees[st];
    reIndexTree(speciesTree,['taxonId']);
    // need reference to parent node on each.
    const highlight = tree.highlight;
    reIndexTree(tree, ['geneId','nodeId','taxonId']);
    let zoneHeight=0;
    tree.visibleUnexpanded.forEach(n_id => {
      let n = tree.nodes[n_id];
      n.displayInfo.offset = zoneHeight;
      zoneHeight += n.displayInfo.height
    });
    return {
      isFetching: state.genetrees.isFetching, header, ...zone, tree, highlight, zoneHeight, speciesTree, goi
    }
  }
  return {
    isFetching: state.genetrees.isFetching, header,
    ...zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ expandNode, collapseNode, swapChildren, updateGenesOfInterest, hoverNode }, dispatch);

export default connect(mapState, mapDispatch, null, {context:myContext})(Tree);

const TreeNode = (props) => {
  const node = props.node;
  const xScale = props.xScale;
  const width = props.width;
  const height = node.displayInfo.height;
  const nodeRadius = props.nodeRadius;
  const highlight = props.highlight[node.nodeId];

  const color = props.speciesTree.indices.taxonId[node.taxonId].color;
  const style = {
    fill: color,
    stroke: color
  };

  let marker,hline,vline,bbox,extension,tally,popover;
  let x=node.scaledDistanceToRoot * xScale;
  let y=(node.vindex-1) * height + height/2;
  const parent = props.tree.nodes[node.parentId];
  let parentX = parent ? parent.scaledDistanceToRoot * xScale : 0;
  bbox = <rect x={parentX} y={y - height/2} width={x - parentX + nodeRadius} height={height} className='bbox'/>;
  if (node.scaleFactor !== 1) {
    hline = <line x1={parentX} y1={y} x2={x} y2={y} strokeDasharray="4, 4" className={`line${node.scaleFactor}`} style={style}/>;
  }
  else {
    hline = <line x1={parentX} y1={y} x2={x} y2={y} className={`line`} style={style}/>;
  }
  if (!node.children || node.children.length === 0) { // leaf
    marker = <circle cx={x} cy={y} r={nodeRadius} className={node.geneId === props.goi ? 'geneOfInterest' : node.class}/>;
    extension = <line x1={x} x2={width} y1={y} y2={y} className='extension'/>;
    if (parent && parent.children.length === 2) {
      const parentX = parent.scaledDistanceToRoot * xScale;
      let parentY = (parent.vindex - 1) * height + height / 2;
      if (parentY < y) { parentY += nodeRadius }
      else { parentY -= nodeRadius }
      let vlineClass = highlight ? 'vline highlight' : 'vline';
      vline = <line x1={parentX} x2={parentX} y1={y} y2={parentY} className={vlineClass} style={style}/>;
    }
  }
  else {
    if (parent && parent.children.length === 2) {
      const parentX = parent.scaledDistanceToRoot * xScale;
      let parentY = (parent.vindex - 1) * height + height / 2;
      if (parentY < y) { parentY += nodeRadius }
      else { parentY -= nodeRadius }
      let vlineClass = highlight ? 'vline highlight' : 'vline';
      vline = <line x1={parentX} x2={parentX} y1={y} y2={parentY} className={vlineClass} style={style}/>;
    }
    if (node.displayInfo.expanded) {
      let w = nodeRadius*1.5;
      if (node.children.length === 2) { // internal
        const c1 = props.tree.nodes[node.children[0]];
        const c2 = props.tree.nodes[node.children[1]];
        let child1Y = (c1.vindex - 1) * height + height / 2;
        let child2Y = (c2.vindex - 1) * height + height / 2;
        bbox = <rect x={parentX} y={child1Y} width={x - parentX + nodeRadius} height={child2Y - child1Y} className='bbox'/>;
        marker = <rect x={x - w/2} y={y - w/2} width={w} height={w} className={node.class} style={style}/>;
        // vline = <line x1={x} x2={x} y1={child1Y} y2={child2Y} className='line'/>;
      }
      else { // pruned child
        w *= 0.3;
        if (parent && node.leftIndex - 1 === parent.leftIndex) {
          marker = <polygon points={`${x - w},${y} ${x},${y - 2 * w} ${x + 2 * w},${y - 2 * w} ${x + w},${y}`}
                            className={node.class} style={style}/>;
        }
        else {
          marker = <polygon points={`${x - w},${y} ${x},${y + 2 * w} ${x + 2 * w},${y + 2 * w} ${x + w},${y}`}
                            className={node.class} style={style}/>;
        }
      }
    }
    else { // collapsed
      marker = <polygon points={`${x},${y-0.4*height} ${x},${y+0.4*height} ${Math.max(parentX+4,x-30)},${y}`}
                        className={node.class} style={style}/>;
      const subtree_size = 0.7*width*node.descendants/props.tree.nodes[node.rootId].descendants;
      marker = <polygon points={`${x+subtree_size},${y-0.4*height} ${x+subtree_size},${y+0.4*height} ${Math.max(parentX+4,x-30)},${y}`}
                        className={node.class} style={style}/>;
      extension = <line x1={x+subtree_size+5+8*Math.ceil(Math.log10(node.descendants))} x2={width} y1={y} y2={y} className='extension'/>;
      tally = <text x={x+subtree_size+5} y={y+5} class="small">{node.descendants}</text>
      // hline = null;
    }
  }

  const nodeClass = highlight ? 'tree-node highlight' : 'tree-node';

  const expandOrCollapse = node => {
    if (node.displayInfo.expanded) {
      props.collapseNode(node);
    }
    else {
      props.expandNode(props.tree.nodes, node.nodeId, true);
    }
  };

  const tooltip = (
    <Popover id={node.nodeId}>
      <Popover.Title as="h3">{node.taxonName} - {node.nodeType}</Popover.Title>
      <Popover.Content>
        <table>
          {
            node.nodeType === 'protein_coding' ?
              <tbody>
                <tr>
                  <th></th>
                  <td>
                    {node.vindex === 1 ?
                      <button onClick={() => {
                        document.body.click();
                        const paralogs = props.tree.indices.taxonId[node.taxonId].map(nodeId => props.tree.nodes[nodeId].geneId);
                        props.updateGenesOfInterest(paralogs);
                      }}>Show Paralogs</button> :
                      <button onClick={() => {document.body.click();props.updateGenesOfInterest([node.geneId])}}>Focus on this gene</button>
                    }
                  </td>
                </tr>
                {node.geneName &&<tr><th>Gene Name</th><td>{node.geneName}</td></tr> }
                <tr><th>Gene Id</th><td>{node.geneId}</td></tr>
                <tr><th>Protein Id</th><td>{node.proteinId}</td></tr>
              </tbody>
            :
              <tbody>
              <tr>
                <td>
                  <button
                    // onClick={() => expandOrCollapse(node)}>{node.displayInfo.expanded ? 'Collapse' : 'Expand'}
                    onClick={() => {document.body.click();props.collapseNode(node)}}>Collapse
                  </button>
                </td>
                <td>
                  <button
                    onClick={() => {document.body.click();props.expandNode(props.tree.nodes, node.nodeId, true)}}>Expand
                  </button>
                </td>
                {node.displayInfo.expanded && <td>
                  <button
                    onClick={() => {document.body.click();props.swapChildren(node)}}>Swap Children
                  </button>
                </td>
                }
              </tr>
              </tbody>
          }
        </table>
      </Popover.Content>
    </Popover>
  );

  return (
    <g className={nodeClass} onMouseOver={()=>props.hoverNode(node.nodeId)}>
      {vline}
      {extension}
      {tally}
      {hline}
      {marker}
      <OverlayTrigger placement="auto"
                      overlay={tooltip}
                      trigger='click'
                      rootClose={true}>
        {bbox}
      </OverlayTrigger>
    </g>
  );
};