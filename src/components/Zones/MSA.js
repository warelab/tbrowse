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
import Slider from 'rc-slider'
import './MSA.css';
import ggp from "gramene-gene-positions";

const chWidth = toPx('1ch');

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

class MSAComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state={};
    this.bodyRef = React.createRef();
  }
  handleRangeChange(from,to) {
    let range = {from,to};
    this.setState({range});
  }
  componentDidUpdate() {
    if (this.props.nodes && !this.props.gaps) {
      this.props.calculateGaps(this.props)
    }
    if (this.props.gaps && !this.state.range) {
      let range = {
        from: 0,
        to: this.props.gaps.maskLen
      };
      this.setState({range});
    }
  }
  render() {
    if (this.state.range && this.props.gaps) {
      return (
        <div>
          <MSAHeader {...this.props} range={this.state.range} updateRange={(f,t)=>this.handleRangeChange(f,t)}/>
          <MSABody onRangeChange={(f,t)=>this.handleRangeChange(f,t)} {...this.props} range={this.state.range} />
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
      let zoneHeight=0;
      nodes.forEach(n => {
        n.displayInfo.offset = zoneHeight;
        zoneHeight += n.displayInfo.height
      });
      const interpro = state.genetrees.interpro;
      const root = tree;
      return { gaps, nodes, highlight, interpro, zoneHeight, root, ...zone }
    }

    return { nodes, ...zone }
  }
  return { ...zone }
};

const mapDispatch = dispatch => bindActionCreators({ calculateGaps, toggleGap, hoverNode }, dispatch);

export default connect(mapState, mapDispatch)(MSAComponent);


class MSAHeader extends React.Component {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.grayScale = d3.scaleLinear().domain([0, 1]).range(["#000000", "#eeeeee"]);
    this.sliderRef = React.createRef();
    this.state = {
      span: props.range.to - props.range.from
    };
  }
  draw() {
    const span = this.props.range.to - this.props.range.from;
    const ratio = span/this.props.gaps.maskLen;
    const canvas = this.canvasRef.current;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createLinearGradient(0,0,0,canvas.height);
    grd.addColorStop(0, this.grayScale(ratio));
    grd.addColorStop(1, this.grayScale(1));
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath();
    ctx.moveTo(this.props.range.from, 0);
    ctx.lineTo(this.props.range.to, 0);
    ctx.lineTo(this.props.range.to,3);
    ctx.lineTo(this.props.gaps.maskLen, canvas.height - 3);
    ctx.lineTo(this.props.gaps.maskLen, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.lineTo(0, canvas.height - 3);
    ctx.lineTo(this.props.range.from,3);
    ctx.closePath();
    ctx.fillStyle = grd;
    ctx.fill();
  }
  componentDidMount() {
    this.draw();
  }
  componentDidUpdate() {
    const span = this.props.range.to - this.props.range.from;
    if (span !== this.state.span) {
      this.setState({span});
    }
    this.sliderRef.current.state.value = this.props.gaps.maskLen - span;
    this.draw();
  }
  changeRange(delta) {
    let from = this.props.range.from - delta;
    if (from < 0) {
      delta -= from;
      from = 0;
    }
    let to = this.props.range.to + delta;
    if (to > this.props.gaps.maskLen) {
      from -= to - this.props.gaps.maskLen;
      to = this.props.gaps.maskLen
      if (from < 0) {
        from = 0;
      }
    }
    this.props.updateRange(Math.floor(from), Math.floor(to));
  }
  handleSliderChange(span) {
    if (span !== this.state.span) {
      this.changeRange((span - this.state.span)/2);
    }
  }
  zoomOut() {
    this.changeRange(Math.floor(0.1*this.state.span));
  }
  zoomIn() {
    this.changeRange(- Math.floor(0.1*this.state.span));
  }
  renderSlider() {
    return (
      <div style={{position:'absolute', top:'11px', left:'calc(100% - 220px', zIndex:1200}}>
          <a style={{position:'absolute'}} onClick={()=>this.zoomOut()}><i className="fa fa-minus-square" /></a>
          <Slider min={0}
                  max={this.props.gaps.maskLen - Math.floor(this.props.width/chWidth)}
                  defaultValue={0}
                  handleStyle={{
                    borderColor: 'black',
                    borderRadius: 1,
                    height: 22,
                    width: 8,
                    marginLeft: 0,
                    marginTop: -9,
                    backgroundColor: 'rgba(255,255,255,0.5)',
                  }}
                  style={{
                    width: '150px',
                    left: '20px',
                    top: '1px',
                    position: 'absolute'
                  }}
                  ref={this.sliderRef}
                  className='rc-slider'
                  onChange={(x)=>this.handleSliderChange(this.props.gaps.maskLen - x)}/>
          <a style={{position:'absolute',left:'181px'}} onClick={()=>this.zoomIn()}><i className="fa fa-plus-square" /></a>
      </div>
    )
  }

  render() {
    const props = this.props;
    const maskLenPx = toPx(props.gaps.maskLen+'ch');
    return (
      <div className='zone-header'>
        {this.renderSlider()}
        <div className='msa' style={{
          width: `${maskLenPx}px`,
          height: '23px',
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / maskLenPx})`
        }}>
          <MSAHistogram node={props.root} {...props}/>
        </div>
        <div style={{
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / props.gaps.maskLen})`,
          width: `${props.gaps.maskLen}px`
        }}>
          <canvas width={`${props.gaps.maskLen}px`} height='32px' ref={this.canvasRef} />
        </div>
      </div>
    )
  }
}

function getZoomLevel({width,range}) {
  const residues = range.to - range.from;
  const pixelsPerResidue = width/residues;
  if (pixelsPerResidue >= 5) {
    return 1
  }
  if (pixelsPerResidue >= 3) {
    return 2
  }
  return 4
}

class MSABody extends React.Component {
  constructor(props) {
    super(props);
    this.myRef = React.createRef();
    this.overviewRef = React.createRef();
    this.state = {
      zoomLevel: getZoomLevel(props)
    }
  }
  componentDidMount() {
    let cmp = this;
    this.myRef.current.addEventListener('wheel', function(event) {
      if (Math.abs(event.deltaY) > 0 && event.shiftKey) {
        event.preventDefault();
        const maskLen = cmp.props.gaps.maskLen;
        const visibleProportion = this.clientWidth/this.scrollWidth;
        let from = cmp.props.range.from;
        let to = cmp.props.range.to;
        const span = cmp.state.zoomLevel === 3 ? to - from : toPx(`${to - from}ch`);
        const delta = cmp.state.zoomLevel === 3 ? Math.ceil(0.01*span) : cmp.state.zoomLevel;
        if (event.deltaY < 0 && (cmp.state.zoomLevel > 1 || this.clientWidth > cmp.props.width)) {
          // zoom in
          from += delta;
          to -= delta;
          cmp.props.onRangeChange(from,to);
          cmp.changeRange(from,to);
        }
        if (event.deltaY > 0 && visibleProportion < 1) {
          // zoom out
          from -= delta;
          to += delta;
          if (from < 0) {from = 0;}
          if (to > maskLen) {to = maskLen;}
          cmp.props.onRangeChange(from,to);
          cmp.changeRange(from,to);
        }
      }
    });
    this.myRef.current.addEventListener('scroll', function(event) {
      const maskLen = cmp.props.gaps.maskLen;
      const span = cmp.props.range.to - cmp.props.range.from;
      const from = Math.floor(maskLen*this.scrollLeft/this.scrollWidth + 0.5);
      cmp.props.onRangeChange(from,from+span);
    }, false);
  }

  changeRange(from, to) {
    let zoomLevel = getZoomLevel({
      width: this.props.width,
      range: {from, to}
    });
    if (zoomLevel !== this.state.zoomLevel) {
      this.setState({zoomLevel});
    }
    else {
      const span = (zoomLevel === 3) ? to - from : toPx(`${to - from}ch`);
      const pixelsPerResidue = this.props.width / span;
      let el = this.myRef.current;
      el.style.transform = `scaleX(${pixelsPerResidue})`;
      el.style.width = `${span}px`;
      el.scrollLeft = el.scrollWidth * from / this.props.gaps.maskLen;
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (
      nextProps.nodes === this.props.nodes &&
      nextProps.gaps.maskLen === this.props.gaps.maskLen &&
      nextProps.width === this.props.width &&
      nextState.zoomLevel === this.state.zoomLevel &&
      nextProps.colorScheme === this.props.colorScheme
    ) {
      if (nextProps.range !== this.props.range) {
        this.changeRange(nextProps.range.from, nextProps.range.to);
      }
      return false;
    }
    return true;
  }

  componentDidUpdate() {
    const el = this.myRef.current;
    el.scrollLeft = el.scrollWidth * this.props.range.from / this.props.gaps.maskLen;
    if (this.state.zoomLevel === 1 && el.clientWidth < this.props.width) {
      const span = this.props.range.to - this.props.range.from;
      const fat = Math.floor((span * this.props.width / el.clientWidth - span)/2);
      let from = this.props.range.from - fat;
      let to = this.props.range.to + fat;
      if (from < 0) {
        to -= from;
        from=0;
      }
      if (to > this.props.gaps.maskLen) {
        from -= to - this.props.gaps.maskLen;
        to = this.props.gaps.maskLen;
        if (from < 0) {
          from = 0;
        }
      }
      this.changeRange(from, to);
    }
  }

  render() {
    const props = this.props;
    const span = (this.state.zoomLevel === 3)
      ? props.range.to - props.range.from
      : toPx(`${props.range.to - props.range.from}ch`);
    return (
      <div ref={this.myRef} className='msa' style={{
        height: props.zoneHeight + props.nodes[0].displayInfo.height + 'px',
        width: `${span}px`,
        transformOrigin: '0 0',
        transform: `scaleX(${props.width / span})`,
      }}>
        {this.state.zoomLevel === 3 && props.nodes.map((node, idx) => <MSAOverview key={idx} node={node} {...props}/>)}
        {this.state.zoomLevel === 4 && props.nodes.map((node, idx) => <MSAHistogram key={idx} node={node} {...this.state} {...props}/>)}
        {this.state.zoomLevel === 5 && <MSAHistogram node={props.root} {...this.state} {...props}/>}
        {this.state.zoomLevel < 3 && props.nodes.map((node, idx) => <MSASequence key={idx} node={node} {...this.state} {...props}/>)}
        {this.state.zoomLevel < 3 && <MSAGaps {...props}/>}
        {/*{this.state.zoomLevel < 3 && <SpliceJunctions {...props}/>}*/}
      </div>
    )
  }
}

const SpliceJunctions = (props) => {
  return (
    <div>
      {props.node.model.gene_structure && props.node.model.gene_structure.exons.map((exon,idx) => {
        if (idx > 0) {
          const junction = ggp.remap(props.node.model,exon.start,'gene','protein');
        }
      })}
    </div>
  )
};
const MSAGaps = (props) => {
  const gaps = props.gaps;
  const span = props.range.to - props.range.from;
  const pixelsPerResidue = props.width / toPx(`${span}ch`);
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
    <div style={{
      zIndex:10,
    }}>&nbsp;
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

const MSASequence = ({node, gaps, highlight, hoverNode, colorScheme, zoomLevel}) => {
  const chunkSize=200;
  if (!node.model.consensus.alignSeq) {
    let alignSeq = '';
    const seqBuffer = node.model.consensus.alignSeqArray.buffer;
    gaps.mask.forEach(block => {
      const mySlice = new Uint16Array(seqBuffer, block.offset * 2, block.len);
      alignSeq += String.fromCharCode.apply(null, mySlice);
    });
    node.model.consensus.alignSeq = chunkSubstr(alignSeq, chunkSize); // speeds up scrolling in safari
  }
  let classes = highlight[node.model.nodeId] ? ' highlight' : '';
  function onHover() { hoverNode(node.model.nodeId) }
//    onMouseOver={_.debounce(onHover,200)}
  if (zoomLevel === 2) {
    classes += ' blank';
  }
  return <div
    className={colorScheme + classes}
    style={{position:'absolute', lineHeight: `${node.displayInfo.height}px`, top:`${node.displayInfo.offset + 24}px`}}
  >
    {node.model.consensus.alignSeq.map((s, i) => {
      return <span key={i} style={{
        position:'absolute',
        left: `${i*chunkSize}ch`
      }}>{s}</span>
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


class MSAOverviewCanvases extends React.Component {
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
                             style={{position:'absolute', left: `${this.domains[idx].offset}px`}}
      />;
      if (this.domains[idx].domain) {
        canvases.push(
            <Tooltip placement="top"
                     key={idx}
                     overlay={this.formatDomain(this.domains[idx].domain)}
                     align={alignParams}
                     trigger={['click']}
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
                             style={{position:'absolute', left: `${this.domains[idx].offset}px`}}
      />;
      if (this.domains[idx].domain) {
        canvases.push(
          <Tooltip placement="top"
                   key={idx}
                   overlay={this.formatDomain(this.domains[idx].domain)}
                   align={alignParams}
                   trigger={['click']}
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

const MSAHistogram = ({node, gaps}) => {
  const chunkSize=200;
  if (!node.model.consensus.alignHist) {
    let alignHist = '';
    const buffer = node.model.consensus.heatmap.buffer;
    gaps.mask.forEach(block => {
      let mySlice = new Uint16Array(buffer, block.offset * 2, block.len);
      alignHist += String.fromCharCode.apply(null, mySlice);
    });
    node.model.consensus.alignHist = chunkSubstr(alignHist, chunkSize); // speeds up scrolling in safari
  }
  return <div
    className='heatmap'
    style={{position:'absolute', lineHeight: `${node.displayInfo.height}px`, top:`${node.displayInfo.offset + 24}px`}}
  >
    {node.model.consensus.alignHist.map((s, i) => {
      return <div key={i} style={{
        position:'absolute',
        left: `${i*chunkSize}ch`
      }}>{s}</div>
    })}
  </div>
};
