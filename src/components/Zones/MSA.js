import React from 'react'
import { connect } from 'react-redux'
import _ from 'lodash';
let d3 = require('d3-scale');
import { getGapParams, calculateGaps, toggleGap, hoverNode } from "../../actions/Genetrees";
import { mergeOverlaps } from "../../utils/treeTools";
import { toPx } from "../../utils/toPx";
import { bindActionCreators } from "redux";
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import Tooltip from 'rc-tooltip';
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
          <MSAHeader {...this.props} />
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
    const nodes = tree.visibleUnexpanded;
    const highlight = tree.highlight;
    const gapParams = JSON.stringify(getGapParams(zone));
    if (tree.gaps.hasOwnProperty(gapParams)) {
      const gaps = tree.gaps[gapParams];
      const msaLength = toPx(gaps.maskLen+'ch');
      const msaResolution = gaps.maskLen / msaLength;
      let zoneHeight=0;
      nodes.forEach(n => {
        n.displayInfo.offset = zoneHeight;
        zoneHeight += n.displayInfo.height
      });
      const interpro = state.genetrees.interpro;
      const root = tree;
      return { gaps, nodes, highlight, interpro, zoneHeight, msaLength, msaResolution, root, ...zone }
    }

    return { nodes, ...zone }
  }
  return { ...zone }
};

const mapDispatch = dispatch => bindActionCreators({ calculateGaps, toggleGap, hoverNode }, dispatch);

export default connect(mapState, mapDispatch)(MSAComponent);


const MSAHeader = (props) => {
  return (
    <div className='zone-header' style={{
      transformOrigin: '0 0',
      transform: `scaleX(${props.width / props.gaps.maskLen})`,
      width: `${props.gaps.maskLen}px`
    }}>
      <MSAOverview node={props.root} {...props}/>
    </div>
  )
};

class MSABody extends React.Component {
  constructor(props) {
    super(props);
    this.myRef = React.createRef();
  }
  componentDidMount() {
    this.myRef.current.addEventListener('mousewheel', function(event) {
      // We don't want to scroll below zero or above the width
      const maxX = this.scrollWidth - this.offsetWidth;

      // If this event looks like it will scroll beyond the bounds of the element, prevent it and set the scroll to the boundary manually 
      if (this.scrollLeft + event.deltaX < 0 || 
          this.scrollLeft + event.deltaX > maxX) {

        event.preventDefault();

        // Manually set the scroll to the boundary
        this.scrollLeft = Math.max(0, Math.min(maxX, this.scrollLeft + event.deltaX));
      }
    }, false);
  }
  render() {
    const props = this.props;
    return (
      <div ref={this.myRef} className='msa' style={{
        height:props.zoneHeight + props.nodes[0].displayInfo.height + 'px',
        width:props.width+'px'
      }}>
        <div style={{zIndex:1}}>
          {props.nodes.map((node,idx) => <MSASequence key={idx} node={node} {...props}/>)}
        </div>
        <div style={{
          zIndex:2,
          visibility:'hidden',
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / props.gaps.maskLen})`,
          width: `${props.gaps.maskLen}px`
        }}>
          {props.nodes.map((node,idx) => <MSAOverview key={idx} node={node} {...props}/>)}
        </div>
        <MSAGaps {...props}/>
      </div>
    )
  }
}

const MSAGaps = (props) => {
  const gaps = props.gaps;
  const zoneHeight = props.zoneHeight;
  const gapParams = getGapParams(props);
  let compression = 0;
  const alignParams = {
    points: ['bc','tc'],
    offset: [0,3],
    targetOffset: [0,0],
    overflow: { adjustX: true, adjustY: true }
  };
  return (
    <div style={{zIndex:10}}>&nbsp;
      {gaps.gaps.map((block,idx) => {
        const text = <div><div>length: {block.len}</div><div>coverage: {block.coverage}</div></div>;
        const marker = block.collapsed ? (
          <div key={block.offset}>
            <Tooltip placement="top"
                     overlay={text}
                     align={alignParams}
            >
              <div className='closed-gap' style={{left: `${block.offset - compression - 1}ch`}} onClick={() => props.toggleGap(idx,gapParams)}/>
            </Tooltip>
            <div className='gap-vline' style={{left: `${block.offset - compression}ch`, height: `${zoneHeight}px`}}/>
          </div>
        ) : (
          <div key={block.offset}>
            <div onClick={() => props.toggleGap(idx,gapParams)}>
              <div className='open-gap-left' style={{left: `${block.offset - compression - 1}ch`}}/>
              <Tooltip placement="top"
                       overlay={text} align={alignParams}
              >
                <div className='open-gap-center' style={{left: `${block.offset - compression}ch`, width: `${block.len}ch`}}/>
              </Tooltip>
              <div className='open-gap-right' style={{left: `${block.offset - compression + block.len}ch`}}/>
            </div>
            <div className='gap-vline' style={{left: `${block.offset - compression}ch`, height: `${zoneHeight}px`}}/>
            <div className='gap-vline' style={{left: `${block.offset - compression + block.len}ch`, height: `${zoneHeight}px`}}/>
          </div>
        );
        if (block.collapsed) {
          compression += block.len;
        }
        return marker;
      })}
    </div>
  )
};

function chunkSubstr(str, size) {
  const numChunks = Math.ceil(str.length / size)
  const chunks = new Array(numChunks)

  for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
    chunks[i] = str.substr(o, size)
  }

  return chunks
}

const MSASequence = ({node, gaps, highlight, hoverNode, colorScheme}) => {
  if (!node.model.consensus.alignSeq) {
    let alignSeq = '';
    const seqBuffer = node.model.consensus.alignSeqArray.buffer;
    gaps.mask.forEach(block => {
      const mySlice = new Uint16Array(seqBuffer, block.offset * 2, block.len);
      alignSeq += String.fromCharCode.apply(null, mySlice);
    });
    node.model.consensus.alignSeq = chunkSubstr(alignSeq, 256); // speeds up scrolling in safari
  }
  const classes = highlight[node.model.nodeId] ? ' highlight' : '';
  function onHover() { hoverNode(node.model.nodeId) }
//    onMouseOver={_.debounce(onHover,200)}
  return <div
    className={colorScheme + classes}
    style={{position:'absolute', lineHeight: `${node.displayInfo.height}px`, top:`${node.displayInfo.offset + 24}px`}}
  >
    {node.model.consensus.alignSeq.map((s, i) => {
      return <span key={i}>{s}</span>
    })}
  </div>
};

function splitByDomain(region, domainHits, domainIdx) {
  let regionStart = region.offset;
  let regionEnd = region.offset + region.len;
  let subregions = [];
  let dIdx = 0;
  while (dIdx < domainHits.length && domainHits[dIdx].start < regionEnd) {
    let domain = domainHits[dIdx];
    dIdx++;
    if (domain.end > regionStart) {
      if (domain.start > regionStart) {
        subregions.push({
          start: regionStart,
          end: domain.start
        });
        regionStart = domain.start;
      }
      if (domain.end <= regionEnd) {
        subregions.push({
          start: regionStart,
          end: domain.end,
          domain: domainIdx[domain.id]
        });
        regionStart = domain.end;
      }
      else {
        subregions.push({
          start: regionStart,
          end: regionEnd,
          domain: domainIdx[domain.id]
        });
        regionStart = regionEnd;
      }
    }
  }
  if (regionStart < regionEnd) {
    subregions.push({
      start: regionStart,
      end: regionEnd
    });
  }
  return subregions;
}


class MSAOverview extends React.Component {
  constructor(props) {
    super(props);
    this.setup(props);
    this.canvasRefs = this.domains.map(d => {
      return React.createRef();
    })
  }

  setup(props) {
    let DA = props.node.model.domainArchitecture;
    let consensus = props.node.model.consensus;
    let domainIdx = props.interpro;
    let domainHits=[];
    if (domainIdx && DA && DA.hasOwnProperty('Domain')) {
      Object.keys(DA.Domain).forEach(rootId => {
        Array.prototype.push.apply(domainHits,DA.Domain[rootId].hits);
      });
      domainHits = mergeOverlaps(domainHits,0,'max');
    }

    let grayScale = d3.scaleLinear().domain([0,1]).range(["#DDDDDD","#444444"]);
    let colorScale = grayScale;
    let blocks = [];
    let blockIdx=0;
    let block = {
      start: 0,
      coverage: 0
    };
    let pos = 0;
    let domainRegions = [];
    let currDomain = {
      firstBlock:0,
      offset:0
    };

    function endBlock(coverage) {
      if (block.coverage > 0) {
        block.width = pos - block.start;
        block.fill = colorScale(block.coverage/consensus.nSeqs);
        blocks.push(block);
        blockIdx++;
      }
      block = {
        start: pos,
        coverage: coverage || 0
      }
    }

    function endDomain(domain) {
      currDomain.nBlocks = blockIdx - currDomain.firstBlock;
      if (currDomain.nBlocks) {
        currDomain.len = pos - blocks[currDomain.firstBlock].start;
        domainRegions.push(currDomain);
      }
      currDomain = {
        firstBlock: blockIdx,
        offset: pos
      };
      if (domain) {
        currDomain.domain = domain;
      }
    }

    props.gaps.mask.forEach(maskRegion => {
      splitByDomain(maskRegion, domainHits, domainIdx).forEach(region => {
        // if this region is a different domain finish the last block
        // and change the colorScale
        if (currDomain.domain) {
          if (!region.domain) {
            endBlock();
            endDomain();
            colorScale = grayScale;
          }
          else if (region.domain.id !== currDomain.domain.id) {
            endBlock();
            endDomain(region.domain);
            colorScale = region.domain.colorScale;
          }
        }
        else if (region.domain) {
          endBlock();
          endDomain(region.domain);
          colorScale = region.domain.colorScale;
        }
        for (let i = region.start; i < region.end; i++) {
          if (consensus.coverage[i] !== block.coverage) { // change in coverage
            endBlock(consensus.coverage[i]);
          }
          pos++;
        }
      });
    });
    endBlock();
    endDomain();
    this.domains = domainRegions.filter(d => d.nBlocks > 0);
    this.blocks = blocks;
    this.maskLen = props.gaps.maskLen;
  }

  draw() {
    this.canvasRefs.forEach((cRef,idx) => {
      let canvas = cRef.current;
      canvas.offScreenCanvas = document.createElement('canvas');
      canvas.offScreenCanvas.width = canvas.width;
      canvas.offScreenCanvas.height = canvas.height;
      const ctx = canvas.offScreenCanvas.getContext('2d');
      const d = this.domains[idx];
      const from=d.firstBlock;
      const to=from+d.nBlocks;
      for(let i=from;i<to;i++) {
        const block = this.blocks[i];
        ctx.fillStyle = block.fill;
        ctx.fillRect(block.start - d.offset, 0, block.width, 18);
      }
      const mainCtx = canvas.getContext('2d');
      mainCtx.clearRect(0,0,canvas.width,canvas.height);
      mainCtx.drawImage(canvas.offScreenCanvas, 0, 0);
    })
  }

  componentDidMount() {
    this.draw();
  }

  componentDidUpdate() {
    this.draw();
  }

  formatDomain(domain) {
    return (
      <div style={{maxWidth: '400px'}}><h3><code>{domain.id}:&nbsp;</code>{domain.nodeName}</h3><p>{domain.nodeDescription || ''}</p></div>
    )
  }

  render() {
    if (this.props.gaps.maskLen !== this.maskLen) {
      this.setup(this.props);
    }
    let canvases = [];
    const alignParams = {
      points: ['tc','bc'],
      offset: [0,3],
      targetOffset: [0,0],
      overflow: { adjustX: true, adjustY: true }
    };
    this.canvasRefs.forEach((cRef, idx) => {
      const canvas = <canvas ref={cRef}
                             key={idx}
                             height="18px"
                             width={`${this.domains[idx].len}px`}
      />;
      if (this.domains[idx].domain) {
        canvases.push(
            <Tooltip placement="top"
                     overlay={this.formatDomain(this.domains[idx].domain)}
                     align={alignParams}
            >
              {canvas}
            </Tooltip>
          );
      }
      else {
        canvases.push(canvas);
      }
    });
    let top = this.props.node.displayInfo.offset || 0;
    top += this.props.nodes[0].displayInfo.height;
    return <div style={{
      position: 'absolute',
      left: '0px',
      top: `${top+3}px`
    }}>{canvases}</div>;
  }
}

