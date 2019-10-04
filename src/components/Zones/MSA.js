import React from 'react'
import { connect } from 'react-redux'
import _ from 'lodash';
let d3 = require('d3-scale');
let units = require('units-css');
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
  let px = props.msaLength;
  return (
    <div className='zone-header' style={{
      transformOrigin: '0 0',
      transform: `scaleX(${props.width / px})`,
      width: `${px}px`
    }}>
      <MSAOverview node={props.root} {...props}/>
      <MSAOverviewClass node={props.root} {...props}/>
    </div>
  )
}

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
        <div style={{zIndex:2, visibility:'hidden'}}>
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


const MSAOverview = (props) => {
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
  let block = {
    start: 0,
    coverage: 0
  };
  function endBlock(coverage) {
    if (block.coverage > 0) {
      block.width = pos - block.start;
      block.fill = colorScale(block.coverage/consensus.nSeqs);
      blocks.push(block)
    }
    block = {
      start: pos,
      coverage: coverage || 0
    }
  }

  let domainRegions = [];
  let currDomain;
  let pos = 0;
  props.gaps.mask.forEach(maskRegion => {
    splitByDomain(maskRegion, domainHits, domainIdx).forEach(region => {
      // if this region is a different domain finish the last block
      // and change the colorScale
      if (currDomain) {
        if (!region.domain) {
          endBlock();
          colorScale = grayScale;
        }
        else if (region.domain.id !== currDomain.domain.id) {
          endBlock();
          colorScale = region.domain.colorScale;
        }
      }
      else if (region.domain) {
        endBlock();
        colorScale = region.domain.colorScale;
      }

      if (region.domain) {
        if (currDomain) {
          if (region.domain.id !== currDomain.domain.id) {
            currDomain.width = pos - currDomain.start;
            domainRegions.push(currDomain);
            currDomain = {
              start: pos,
              domain: region.domain
            };
          }
        }
        else {
          currDomain = {
            start: pos,
            domain: region.domain
          };
        }
      }
      else if (currDomain) {
        currDomain.width = pos - currDomain.start;
        domainRegions.push(currDomain);
        currDomain = undefined;
      }
      for (let i = region.start; i < region.end; i++) {
        if (consensus.coverage[i] !== block.coverage) { // change in coverage
          endBlock(consensus.coverage[i]);
        }
        pos++;
      }
    });
  });
  if (currDomain) {
    currDomain.width = pos - currDomain.start;
    domainRegions.push(currDomain);
  }
  endBlock();

  let domainBlocks = domainRegions.map((d, idx) => {
    const style = {
      background: d.domain.colorScale(1),
      left: `${d.start}ch`,
      width: `${d.width}ch`,
      top: '1px',
      position: 'absolute',
      height: '20px'
    };
    return <div className='domain' key={idx} style={style}/>
  });

  let coverageBlocks = blocks.map((b,idx) => {
    const style = {
      left: `${b.start}ch`,
      width: `${b.width}ch`,
      top: '4px',
      position: 'absolute',
      background: b.fill,
      height: '17px'
    };
    return <div key={idx} style={style}/>
  });
  let top = props.node.displayInfo.offset || 0;
  top += props.nodes[0].displayInfo.height;
  return (
    <div style={{position:'absolute', top:top, lineHeight:props.node.displayInfo.height}}>
      <div className='coverage-blocks'>{coverageBlocks}</div>
      <div className='domain-blocks'>{domainBlocks}</div>
    </div>
  );
}

class MSAOverviewClass extends React.Component {
  constructor(props) {
    super(props);
    this.canvas1 = React.createRef();
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
    let block = {
      start: 0,
      coverage: 0
    };
    function endBlock(coverage) {
      if (block.coverage > 0) {
        block.width = pos - block.start;
        block.fill = colorScale(block.coverage/consensus.nSeqs);
        blocks.push(block)
      }
      block = {
        start: pos,
        coverage: coverage || 0
      }
    }

    let domainRegions = [];
    let currDomain;
    let pos = 0;
    props.gaps.mask.forEach(maskRegion => {
      splitByDomain(maskRegion, domainHits, domainIdx).forEach(region => {
        // if this region is a different domain finish the last block
        // and change the colorScale
        if (currDomain) {
          if (!region.domain) {
            endBlock();
            colorScale = grayScale;
          }
          else if (region.domain.id !== currDomain.domain.id) {
            endBlock();
            colorScale = region.domain.colorScale;
          }
        }
        else if (region.domain) {
          endBlock();
          colorScale = region.domain.colorScale;
        }

        if (region.domain) {
          if (currDomain) {
            if (region.domain.id !== currDomain.domain.id) {
              currDomain.width = pos - currDomain.start;
              domainRegions.push(currDomain);
              currDomain = {
                start: pos,
                domain: region.domain
              };
            }
          }
          else {
            currDomain = {
              start: pos,
              domain: region.domain
            };
          }
        }
        else if (currDomain) {
          currDomain.width = pos - currDomain.start;
          domainRegions.push(currDomain);
          currDomain = undefined;
        }
        for (let i = region.start; i < region.end; i++) {
          if (consensus.coverage[i] !== block.coverage) { // change in coverage
            endBlock(consensus.coverage[i]);
          }
          pos++;
        }
      });
    });
    if (currDomain) {
      currDomain.width = pos - currDomain.start;
      domainRegions.push(currDomain);
    }
    endBlock();
    this.domains = domainRegions;
    this.blocks = blocks;
  }

  draw(props) {
    let res = props.msaLength / props.gaps.maskLen;
    let canvas = this.canvas1.current;
    canvas.offScreenCanvas = document.createElement('canvas');
    canvas.offScreenCanvas.width = canvas.width;
    canvas.offScreenCanvas.height = canvas.height;
    let ctx = canvas.offScreenCanvas.getContext('2d');
    this.blocks.forEach(block => {
      ctx.fillStyle = block.fill;
      ctx.fillRect(Math.floor(block.start*res), 0, Math.ceil(block.width*res), 18);
    });
    canvas.getContext('2d').drawImage(canvas.offScreenCanvas, 0, 0);
  }

  componentDidMount() {
    this.setup(this.props);
    this.draw(this.props);
  }

  componentDidUpdate() {
    this.setup(this.props);
    this.draw(this.props);
  }

  // shouldComponentUpdate(nextProps) {
  //   if (Math.floor(nextProps.width) !== Math.floor(this.props.width)) {
  //     return true;
  //   }
  //   if (nextProps.gaps.maskLen !== this.props.gaps.maskLen) {
  //     this.setup(nextProps);
  //     this.draw(nextProps);
  //   }
  //   return false;
  // }

  render() {
    return (
      <canvas style={{
        background: 'red',
        position: 'absolute',
        left: '0px',
        top: `${this.props.node.displayInfo.offset}px`
      }} ref={this.canvas1} height="18px" width={`${this.props.msaLength}px`}/>
    )
  }
}

