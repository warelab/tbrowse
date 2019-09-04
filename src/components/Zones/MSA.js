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
    const nodes = tree.visibleNodes;
    const highlight = tree.highlight;
    const gapParams = JSON.stringify(getGapParams(zone));
    if (tree.gaps.hasOwnProperty(gapParams)) {
      const gaps = tree.gaps[gapParams];
      return { gaps, nodes, highlight, ...zone }
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
  <div style={{overflowX:'scroll', overflowY:'hidden'}}>
    {props.nodes.filter(node => !(node.children && node.displayInfo.expanded)).map((node, idx) => {
      if (!node.model.consensus.alignSeq) {
        let alignSeq = '';
        node.model.consensus.alignSeq = [];
        const seqBuffer = node.model.consensus.alignSeqArray.buffer;
        props.gaps.mask.forEach(block => {
          const mySlice = new Uint16Array(seqBuffer, block.offset*2, block.len);
          alignSeq += String.fromCharCode.apply(null, mySlice);
          // this helps in safari with scrolling speed
          // if (alignSeq.length > 256) {
          //   node.model.consensus.alignSeq.push(alignSeq);
          //   alignSeq = '';
          // }
        });
        node.model.consensus.alignSeq = alignSeq.split(/(-+)/); // work around for different widths of '-'
      }
      const highlight = props.highlight[node.model.nodeId]? ' highlight' : '';
      return <div
        key={idx}
        onMouseOver={()=>props.hoverNode(node.model.nodeId)}
        className={props.colorScheme+highlight}
        style={{whiteSpace:'nowrap', lineHeight:node.displayInfo.height}}
      >
        {node.model.consensus.alignSeq.map((s,i) => {
          if (s.charAt(0) === '-') {  // work around for different widths of '-'
            return <span key={i} style={{fontFamily: 'clustal'}}>{s}</span>
          }
          return <span key={i}>{s}</span>
        })}
      </div>;
    })}
  </div>
);

