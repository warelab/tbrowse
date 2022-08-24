import React from 'react'
import { connect } from 'react-redux'
import myContext from '../../store/context'
let d3 = require('d3-scale');
import { getGapParams, calculateGaps, toggleGap, hoverNode } from "../../actions/Genetrees";
import { getGapMask, lowerBound } from "../../utils/treeTools";
import { toPx } from "../../utils/toPx";
import { bindActionCreators } from "redux";
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import Tooltip from 'rc-tooltip';
import ReactTooltip from 'react-tooltip';
import Slider from 'rc-slider'
import './MSA.css';
import ggp from "gramene-gene-positions";
import {updateZoneParam} from "../../reducers/Layout";

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
    this.props.updateZoneParam({idx:this.props.zoneId, id:'range', value:range})
    // this.setState({range});
  }
  componentDidUpdate() {
    if (this.props.nodes && !this.props.gaps) {
      this.props.calculateGaps(this.props)
    }
    if (this.props.gaps && !this.props.range) {
      let range = {
        from: 0,
        to: this.props.gaps.maskLen
      };
      this.props.updateZoneParam({idx:this.props.zoneId, id:'range', value:range});
      // this.setState({range});
    }
  }
  componentDidMount() {
    if (this.props.nodes && !this.props.gaps) {
      this.props.calculateGaps(this.props)
    }
    if (this.props.gaps && !this.props.range) {
      let range = {
        from: 0,
        to: this.props.gaps.maskLen
      };
      this.props.updateZoneParam({idx:this.props.zoneId, id:'range', value:range});
      // this.setState({range});
    }
  }
  render() {
    if (this.props.header) {
      if (this.props.range) {
        return (
          <MSAHeader {...this.props} onRangeChange={(f, t) => this.handleRangeChange(f, t)} updateRange={(f, t) => this.handleRangeChange(f, t)}/>
        )
      }
      return null;
    }
    if (this.props.range && this.props.gaps) {
      return (
        <div>
          <MSABody onRangeChange={(f, t) => this.handleRangeChange(f, t)} {...this.props}/>
          <ReactTooltip id='domain'
                        getContent={(dataTip) => {
                          const domain = JSON.parse(dataTip);
                          return domain && (
                            <div style={{maxWidth: '400px'}}><h3><code>{domain.id}:&nbsp;</code>{domain.nodeName}
                            </h3><p>{domain.nodeDescription || ''}</p></div>
                          )
                        }}
                        effect='float'
                        place={'bottom'}
                        border={true}
                        type={'light'}
          />
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

const mapDispatch = dispatch => bindActionCreators({ calculateGaps, toggleGap, hoverNode, updateZoneParam }, dispatch);

export default connect(mapState, mapDispatch, null, {context:myContext})(MSAComponent);


class MSAHeader extends React.Component {
  constructor(props) {
    super(props);
    this.canvasRef = React.createRef();
    this.grayScale = d3.scaleLinear().domain([0, 1]).range(["#7c0000", "#fef2f2"]);

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
    ctx.lineTo(0, canvas.height );
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
  zoomOut() {[]
    this.changeRange(Math.floor(0.1*this.state.span));
  }
  zoomIn() {
    this.changeRange(- Math.floor(0.1*this.state.span));
  }
  renderSlider() {
    return (
      <div style={{position:'absolute', top:'-20px', left:'calc(100% - 230px', zIndex:1200}}>
          <a style={{position:'absolute', top:'-0.5rem', lineHeight:2}} onClick={()=>this.zoomOut()}><i className="fa fa-minus-square" /></a>
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
          <a style={{position:'absolute', top:'-0.5rem', lineHeight:2, left:'181px'}} onClick={()=>this.zoomIn()}><i className="fa fa-plus-square" /></a>
      </div>
    )
  }

  render() {
    const props = this.props;
    const span = toPx(`${props.range.to - props.range.from}ch`);
    const maskLenPx = toPx(props.gaps.maskLen+'ch');
    return (
      <div className='zone-header' style={{width: `${props.width}px`}}>
        {this.renderSlider()}
        <div className='msa' style={{
          width: `${maskLenPx}px`,
          height: '23px',
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / maskLenPx})`
        }}>
          <MSAHistogram node={props.root} isHeader={true} {...props}/>
        </div>
        <div style={{
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / props.gaps.maskLen})`,
          width: `${props.gaps.maskLen}px`
        }}>
          <canvas width={`${props.gaps.maskLen}px`} height='32px' ref={this.canvasRef} />
        </div>
        <MSABody {...props}/>
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
  return 3
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
    const rpp = toPx(`${this.props.range.to - this.props.range.from}ch`)/this.props.width;
    this.myRef.current.style.setProperty("--residues-per-pixel",rpp);
    this.myRef.current.addEventListener('wheel', function(event) {
      // We don't want to scroll below zero or above the width
      const maxX = this.scrollWidth - this.offsetWidth;
      // If this event looks like it will scroll beyond the bounds of the element, prevent it and set the scroll to the boundary manually
      if (this.scrollLeft + event.deltaX < 0 ||
        this.scrollLeft + event.deltaX > maxX) {

        event.preventDefault();

        // Manually set the scroll to the boundary
        this.scrollLeft = Math.max(0, Math.min(maxX, this.scrollLeft + event.deltaX));
      }
      if (Math.abs(event.deltaY) > 0 && event.shiftKey) {
        event.preventDefault();
        const maskLen = cmp.props.gaps.maskLen;
        const visibleProportion = this.clientWidth/this.scrollWidth;
        let from = cmp.props.range.from;
        let to = cmp.props.range.to;
        const span = toPx(`${to - from}ch`);
        const delta = cmp.state.zoomLevel === 3 ? Math.ceil(0.001*span) : cmp.state.zoomLevel;
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
      const from = Math.floor(maskLen * this.scrollLeft / this.scrollWidth + 0.5);
      cmp.props.onRangeChange(from, from + span);
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
      const span = toPx(`${to - from}ch`);
      const pixelsPerResidue = this.props.width / span;
      const residuesPerPixel = span / this.props.width;
      let el = this.myRef.current;
      el.style.transform = `scaleX(${pixelsPerResidue})`;
      el.style.width = `${span}px`;
      el.scrollLeft = el.scrollWidth * from / this.props.gaps.maskLen;
      el.style.setProperty("--residues-per-pixel", residuesPerPixel);
    }
  }

  shouldComponentUpdate(nextProps, nextState) {
    if (
      nextProps.nodes === this.props.nodes &&
      nextProps.gaps.maskLen === this.props.gaps.maskLen &&
      nextProps.width === this.props.width &&
      nextState.zoomLevel === this.state.zoomLevel &&
      nextProps.colorScheme === this.props.colorScheme &&
      nextProps.zoneHeight === this.props.zoneHeight &&
      nextProps.highlight === this.props.highlight
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
    const rpp = toPx(`${this.props.range.to - this.props.range.from}ch`)/this.props.width;
    el.style.setProperty("--residues-per-pixel",rpp);
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
    const span = toPx(`${props.range.to - props.range.from}ch`);
    if (props.header) {
      return (
        <div ref={this.myRef} className='msa' style={{
          height: 0 + props.nodes[0].displayInfo.height + 'px',
          width: `${span}px`,
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / span})`,
          position: 'absolute',
          top: '36px'
        }}>
          {this.state.zoomLevel < 3 && <MSAGaps {...props}/>}
        </div>
      )
    }
    else {
      return (
        <div ref={this.myRef} className='msa' style={{
          height: props.zoneHeight + props.nodes[0].displayInfo.height + 'px',
          width: `${span}px`,
          transformOrigin: '0 0',
          transform: `scaleX(${props.width / span})`,
        }}>
          {/*{this.state.zoomLevel === 3 && props.nodes.map((node, idx) => <MSAOverview key={idx} node={node} {...props}/>)}*/}
          {this.state.zoomLevel === 3 && props.nodes.map((node, idx) => <MSAHistogram key={idx} node={node} {...this.state} {...props}/>)}
          {/*{this.state.zoomLevel === 5 && <MSAHistogram node={props.root} {...this.state} {...props}/>}*/}
          {this.state.zoomLevel < 3 && props.nodes.map((node, idx) => <MSASequence key={idx} node={node} {...this.state} {...props}/>)}
          {this.state.zoomLevel < 3 && <MSAGaps {...props}/>}
          {this.state.zoomLevel < 9 && props.nodes.map((node, idx) => <SpliceJunctions key={idx} node={node} {...this.state} {...props}/>)}
        </div>
      )
    }
  }
}

const projectSeqToMSA = (pos,node) => {
  if (!node.msaMap) {
    const gaps = getGapMask(node, 1, 1, 0); // use this function to mark the regions in the msa
    let startPositions = new Uint16Array(gaps.mask.length); // do binary search on this
    let posInSeq = 0;
    gaps.mask.forEach((region, idx) => {
      startPositions[idx] = posInSeq;
      posInSeq += region.len;
    });
    node.msaMap = {
      arr: startPositions,
      mask: gaps.mask
    }
  }
  const i = lowerBound(0, node.msaMap.arr.length-1, node.msaMap.arr, pos);
  return node.msaMap.mask[i].offset + pos - node.msaMap.arr[i];
};

const projectMSAToDisplay = (pos, gaps) => {
  const arr = gaps.offsets;
  const i = lowerBound(0, arr.length-1, arr, pos);
  if (pos - arr[i] < gaps.mask[i].len) {
    return gaps.starts[i] + pos - arr[i];
  }
  return -1;
};

const SpliceJunctions = (props) => (
  <div
    style={{position:'absolute', top:`${props.node.displayInfo.offset}px`}}
  >
    {props.node.gene_structure && props.node.gene_structure.exons.map((exon,idx) => {
      if (idx > 0) {
        const junction = ggp.remap(props.node,exon.start,'gene','protein');
        if (junction > 0) {
          const msaPos = projectSeqToMSA(junction - 1, props.node);
          const displayPos = projectMSAToDisplay(msaPos, props.gaps);
          if (displayPos >= 0) return <div
            className='splice-junction'
            style={{
              left: `${displayPos}ch`
            }}
            key={idx}
          />
        }
      }
    })}
  </div>
);

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
  if (props.header) {
    return (
      <div style={{
        zIndex: 10,
      }}>
        {gaps.gaps.map((block, idx) => {
          const text = <div>
            <div>length: {block.len}</div>
            <div>coverage: {block.coverage}</div>
          </div>;
          const marker = block.collapsed ? (
            <div key={block.offset}>
              <Tooltip placement="top"
                       overlay={text}
                       align={alignParams}
              >
                <div className='closed-gap' style={{left: `${block.offset - compression - 1}ch`}}
                     onClick={() => props.toggleGap(idx, gapParams)}/>
              </Tooltip>
            </div>
          ) : (
            <div key={block.offset}>
              <div onClick={() => props.toggleGap(idx, gapParams)}>
                <div className='open-gap-left' style={{left: `${block.offset - compression - 1}ch`}}/>
                <Tooltip placement="top"
                         overlay={text} align={alignParams}
                >
                  <div className='open-gap-center'
                       style={{left: `${block.offset - compression}ch`, width: `${block.len}ch`}}/>
                </Tooltip>
                <div className='open-gap-right' style={{left: `${block.offset - compression + block.len}ch`}}/>
              </div>
            </div>
          );
          if (block.collapsed) {
            compression += block.len;
          }
          return marker;
        })}
      </div>
    )
  }
  else {
    return (
      <div style={{
        zIndex: 10,
      }}>
        {gaps.gaps.map((block, idx) => {
          const marker = block.collapsed ? (
            <div key={block.offset} className='gap-vline' style={{left: `${block.offset - compression}ch`, height: `${zoneHeight}px`}}/>
          ) : (
            <div key={block.offset}>
              <div className='gap-vline' style={{left: `${block.offset - compression}ch`, height: `${zoneHeight}px`}}/>
              <div className='gap-vline'
                   style={{left: `${block.offset - compression + block.len}ch`, height: `${zoneHeight}px`}}/>
            </div>
          );
          if (block.collapsed) {
            compression += block.len;
          }
          return marker;
        })}
        <div className='closed-gap' style={{visibility:'hidden', left: `${gaps.maskLen - 1}ch`}}/>
      </div>
    )
  }
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
  if (!node.consensus.alignSeq) {
    let alignSeq = '';
    const seqBuffer = node.consensus.alignSeqArray.buffer;
    gaps.mask.forEach(block => {
      const mySlice = new Uint16Array(seqBuffer, block.offset * 2, block.len);
      alignSeq += String.fromCharCode.apply(null, mySlice);
    });
    node.consensus.alignSeq = chunkSubstr(alignSeq, chunkSize); // speeds up scrolling in safari
  }
  let classes = zoomLevel === 1 && highlight[node.nodeId] ? ' highlight' : '';
  function onHover() {
    if(zoomLevel === 1) {
      hoverNode(node.nodeId)
    }
  }
//    onMouseOver={_.debounce(onHover,200)}
  if (zoomLevel === 2) {
    classes += ' blank';
  }
  return <div
    onMouseOver={_.debounce(onHover,10)}
    className={colorScheme + classes}
    style={{position:'absolute', lineHeight: `${node.displayInfo.height}px`, top:`${node.displayInfo.offset}px`}}
  >
    {node.consensus.alignSeq.map((s, i) => {
      return <span key={i} style={{
        position:'absolute',
        left: `${i*chunkSize}ch`
      }}>{s}</span>
    })}
  </div>
};


const MSAHistogram = ({node, gaps, interpro, isHeader}) => {
  const chunkSize=200;
  const unmaskedLen = node.consensus.heatmap.length;
  let regions = [{
    start: 0,
    end: unmaskedLen
  }];
  let lastRegion = regions[0];
  if (node.domainHits) {
    node.domainHits.forEach(dh => {
      lastRegion = regions[regions.length - 1];
      if (dh.start < lastRegion.end) {
        lastRegion.end = dh.start
      }
      if (dh.start > lastRegion.end) {
        regions.push({
          start: lastRegion.end,
          end: dh.start
        })
      }
      regions.push(dh);
    });
    lastRegion = regions[regions.length - 1];
    if (lastRegion.end < unmaskedLen) {
      regions.push({
        start: lastRegion.end,
        end: unmaskedLen
      })
    }
  }
  const mask = gaps.mask;
  const buffer = node.consensus.heatmap.buffer;
  let blockIdx = 0;
  let chunkOffset=0;
  const top = isHeader ? '0px' : `${node.displayInfo.offset}px`;
  const cmp = (
    <div
      className='heatmap'
      style={{position:'absolute', lineHeight: `${node.displayInfo.height}px`, top: top}}
    >
      {regions.map((region,i) => {
        let alignHist = '';
        if (blockIdx < mask.length && mask[blockIdx].offset < region.start) {
          // block started in prior region
          let len = region.end - region.start;
          if (mask[blockIdx].offset + mask[blockIdx].len <= region.end) {
            // block ends within region
            len = mask[blockIdx].len - (region.start - mask[blockIdx].offset);
            blockIdx++;
          }
          const mySlice = new Uint16Array(buffer, region.start * 2, len);
          alignHist += String.fromCharCode.apply(null, mySlice);
        }
        while (blockIdx < mask.length && mask[blockIdx].offset + mask[blockIdx].len <= region.end) {
          // block is within the region
          const mySlice = new Uint16Array(buffer, mask[blockIdx].offset * 2, mask[blockIdx].len);
          alignHist += String.fromCharCode.apply(null, mySlice);
          blockIdx++;
        }
        if (blockIdx < mask.length && mask[blockIdx].offset >= region.start && mask[blockIdx].offset < region.end) {
          // block spans region boundary
          let offset = Math.max(region.start,mask[blockIdx].offset);
          const mySlice = new Uint16Array(buffer, offset * 2, region.end - offset);
          alignHist += String.fromCharCode.apply(null, mySlice);
        }
        return region.id && interpro && interpro.hasOwnProperty(region.id) ? (
          <div key={i} data-for='domain' data-tip={JSON.stringify(interpro[region.id])} style={{cursor: 'pointer'}}>
            {chunkSubstr(alignHist, chunkSize).map((s,j) => {
              let chunkCmp = (
                <div key={j} style={{left:`${chunkOffset}ch`, top:0, position:'absolute'}}>{s}</div>
              );
              chunkOffset += s.length;
              return chunkCmp;
            })}
          </div>
        ) :
        (
          <div key={i} style={{cursor: 'default'}}>
            {chunkSubstr(alignHist, chunkSize).map((s,j) => {
              let chunkCmp = (
                <div key={j} style={{left:`${chunkOffset}ch`, top:0, position:'absolute'}}>{s}</div>
              );
              chunkOffset += s.length;
              return chunkCmp;
            })}
          </div>
        )
      })}
    </div>
  );
  return cmp;
};
