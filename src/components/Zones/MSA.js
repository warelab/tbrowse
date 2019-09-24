import React from 'react'
import { connect } from 'react-redux'
import { getGapParams, calculateGaps, hoverNode } from "../../actions/Genetrees";
import { bindActionCreators } from "redux";
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import './MSA.css';

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

class MSAComponent extends React.Component {
  constructor(props) {
    super(props);
  }
  componentDidUpdate() {
    if (this.props.nodes && !this.props.gaps) {
      this.props.calculateGaps(this.props)
    }
  }
  render() {
    if (this.props.gaps) {
      return (
        <div>
          <MSAHeader/>
          <MSABody {...this.props} />
        </div>
      );
    }
    return (
      <div className='sweet-loading'>
        <BarLoader
          css={override}
          sizeUnit={"px"}
          size={this.props.width}
          color={'#123abc'}
          loading={!this.props.gaps}
        />
      </div>
    )
  }
}

const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  if (state.genetrees.trees.hasOwnProperty(state.genetrees.currentTree)) {
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    const nodes = tree.visibleNodes.filter(node => !(node.children.length > 0 && node.displayInfo.expanded));
    const highlight = tree.highlight;
    const gapParams = JSON.stringify(getGapParams(zone));
    if (tree.gaps.hasOwnProperty(gapParams)) {
      const gaps = tree.gaps[gapParams];
      let zoneHeight=0;
      nodes.forEach(n => {
        zoneHeight += n.displayInfo.height
      });
      return { gaps, nodes, highlight, zoneHeight, ...zone }
    }

    return { nodes, ...zone }
  }
  return { ...zone }
};

const mapDispatch = dispatch => bindActionCreators({ calculateGaps, hoverNode }, dispatch);

export default connect(mapState, mapDispatch)(MSAComponent);


const MSAHeader = (props) => (
  <p>MSA Header</p>
);

const MSABody = (props) => (
  <div className='msa' style={{top:'-1em'}}>
    <MSAAxis {...props}/>
    {props.nodes.map((node, idx) => (
      <MSASequence key={idx} node={node} {...props}/>
      // <MSAOverview key={idx} node={node} {...props}/>
    ))}
  </div>
);

const MSAAxis = ({gaps, zoneHeight}) => {
  let compression = 0;
  return (
    <div className='gaps'>&nbsp;
      {gaps.gaps.map(block => {
        const marker = (
          <div key={block.offset}>
            <div className='closed-gap' style={{left: `${block.offset - compression - 1}ch`}}/>
            <div className='gap-vline' style={{left: `${block.offset - compression}ch`, height: `${zoneHeight}px`}}/>
          </div>
        );
        compression += block.len;
        return marker;
      })}
    </div>
  )
};

const MSASequence = ({node, gaps, highlight, hoverNode, colorScheme}) => {
  if (true) { // !node.model.consensus.alignSeq) {
    // This block needs to happen when gap params change. For now, do it on every render
    let alignSeq = '';
    node.model.consensus.alignSeq = [];
    const seqBuffer = node.model.consensus.alignSeqArray.buffer;
    gaps.mask.forEach(block => {
      const mySlice = new Uint16Array(seqBuffer, block.offset * 2, block.len);
      alignSeq += String.fromCharCode.apply(null, mySlice);
      // this helps in safari with scrolling speed
      if (alignSeq.length > 256) {
        node.model.consensus.alignSeq.push(alignSeq);
        alignSeq = '';
      }
    });
    if (alignSeq.length > 0) {
      node.model.consensus.alignSeq.push(alignSeq);
    }
  }
  const classes = highlight[node.model.nodeId] ? ' highlight' : '';
  return <div
    onMouseOver={() => hoverNode(node.model.nodeId)}
    className={colorScheme + classes}
    style={{lineHeight: `${node.displayInfo.height}px`}}
  >
    {node.model.consensus.alignSeq.map((s, i) => {
      return <span key={i}>{s}</span>
    })}
  </div>
};

