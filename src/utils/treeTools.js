import TreeModel from 'tree-model';
import _ from 'lodash';
let d3 = require('d3-scale');
let d3chrom = require('d3-scale-chromatic');
const regionColors = d3chrom.schemeCategory10;
const unanchoredColor = '#d3d3d3';

export function initTreeColors(primary_neighborhood, goi) {
  let range = ['red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'darkviolet'];
  if (goi.geneStrand === '-1') {
    range = range.reverse();
  }
  let treeMap = {}; // key is treeId value is a number based on relative position in neighborhood

  let center_idx = goi.geneRank[0]; // always green
  let d = 0;
  treeMap[goi.treeId] = d;
  let i, nLeft=0, nRight=0;
  // trees left of center
  const firstNeighbor = goi.geneNeighbors[0];
  const lastNeighbor = goi.geneNeighbors[goi.geneNeighbors.length - 1];
  for(i=center_idx-1; i >= firstNeighbor; i--) {
    let gene = primary_neighborhood[i];
    if (gene && gene.treeId && !treeMap[gene.treeId]) {
      treeMap[gene.treeId] = --d;
      nLeft--;
    }
  }
  // trees right of center
  d=0;
  for(i=center_idx+1;i<=lastNeighbor;i++) {
    let gene = primary_neighborhood[i];
    if (gene && gene.treeId && !treeMap[gene.treeId]) {
      treeMap[gene.treeId] = ++d;
      nRight++;
    }
  }

  let domain = [
    nLeft,
    2*nLeft/3,
    nLeft/3,
    0,
    nRight/3,
    2*nRight/3,
    nRight
  ];
  if (nLeft === 0) {
    domain = domain.slice(3);
    range = range.slice(3);
  }
  if (nRight === 0) {
    domain = domain.reverse().slice(3).reverse();
    range = range.reverse().slice(3).reverse();
  }

  let scale = d3.scaleLinear()
    .domain(domain)
    .range(range);

  if (domain.length === 1) {
    scale = function (value) { return "green" }
  }
  return {scale, treeMap};
}

export function reIndexTree(tree, attrs) {
  tree.indices = {};
  attrs.forEach(a => {tree.indices[a] = {}});
  const indexNode = (node,parent) => {

    attrs.forEach(a => {
      let key = node[a];
      if (!_.isUndefined(key)) {
        tree.indices[a][key] = node;
      }
    });
    node.children && node.children.forEach(child => {
      indexNode(child,node);
    });
  };
  indexNode(tree, undefined);
}

function indexTree(tree, attrs, nodeHeight) {
  const MIN_DIST = 0.05;
  const MAX_DIST = 2;
  tree.indices = {};
  attrs.forEach(a => {tree.indices[a] = {}});
  const indexNode = (node,parent) => {
    node.displayInfo = { expanded : false, height : nodeHeight };
    node.class = node.nodeType; // todo: geneOfInterest/orthologs/paralogs
    node.distanceToRoot = (parent ? parent.distanceToRoot : 0) + node.distanceToParent;
    let parentDist = Math.max(node.distanceToParent, MIN_DIST);
    node.scaleFactor = 1;
    while (parentDist > MAX_DIST) {
      parentDist /= 10;
      node.scaleFactor *= 10;
    }
    node.scaledDistanceToRoot = (parent ? parent.scaledDistanceToRoot : 0) + parentDist;

    if (parent) {
      node.parentId = parent.nodeId;
    }

    attrs.forEach(a => {
      let key = node[a];
      if (!_.isUndefined(key)) {
        tree.indices[a][key] = node;
      }
    });
    node.children && node.children.forEach(child => {
      indexNode(child,node);
    });
  };
  indexNode(tree, undefined);
}

function sumBranchLengths(node) {
  if (node.distanceToParent === 0) {
    node.distanceToParent = 1;
  }
  let sum = node.distanceToParent;
  node.children && node.children.forEach(child => {
    sum += sumBranchLengths(child);
  });
  return sum;
}

function flattenTree(node) {
  if (node.children) {
    if (node.children.length === 2) {
      return _.concat(flattenTree(node.children[0]), node, flattenTree(node.children[1]));
    }
    if (node.children.length === 1) { // pruned branch
      return _.concat(flattenTree(node.children[0], node));
    }
    if (node.children.length > 2) {
      let nodes = [];
      node.children.forEach(child => {
        let flatChildren = flattenTree(child);
        flatChildren.forEach(fc => {
          nodes.push(fc);
        })
      });
      nodes.push(node);
      return nodes;
    }
  }
  return [node];
}

function colorByDistance(tree) {
  let nodeOrder = flattenTree(tree);
  let flatDist = 0;
  nodeOrder.forEach(node => {
    let midpoint = flatDist + node.distanceToParent/2;
    node.branchColor = d3chrom.interpolateTurbo(midpoint/tree.totalLength);
    flatDist += node.distanceToParent
  });
}

export function prepTree(genetree,nodeHeight) {
  function leftIndexComparator(a, b) {
    if (a.leftIndex) {
      return a.leftIndex > b.leftIndex ? 1 : -1;
    }
    else {
      return a.nodeId > b.nodeId ? 1 : -1;
    }
  }
  let tree = new TreeModel({modelComparatorFn: leftIndexComparator}).parse(genetree);

  genetree = tree.model; // we don't want the other decorations, just sorted children.

  indexTree(genetree, ['geneId','nodeId'],nodeHeight);


  genetree.totalLength = sumBranchLengths(genetree);

  return genetree
}

export function prepSpeciesTree(tree, taxonId) {
  if (taxonId > 0) {
    reIndexTree(tree, ['taxonId','nodeId']);
    let node = tree.indices.taxonId[taxonId];
    pivotBranches(tree,node);
  }

  tree.totalLength = sumBranchLengths(tree);
  let colorScale = d3.scaleLinear()
    .domain([0, tree.totalLength])
    .range(['green', 'red']);
  let nodeOrder = flattenTree(tree);
  let flatDist = 0;
  tree.leafOrder={};
  tree.leafCount=0;
  nodeOrder.forEach(node => {
    let midpoint = flatDist + node.distanceToParent/2;
    node.color = colorScale(midpoint); //d3chrom.interpolateRainbow(midpoint/tree.totalLength);
    flatDist += node.distanceToParent;
    if (!node.children) {
      tree.leafOrder[node.taxonId] = tree.leafCount++;
      if (node.genomeAssembly) {
        node.regionColor={};
        node.genomeAssembly.regions.names.forEach((r,i) => {
          node.regionColor[r] = r === 'UNANCHORED' ? unanchoredColor: regionColors[i % regionColors.length];
        })
      }
    }
  });
  return tree;
}

function pivotBranches(tree, node) {
  while (node.parentId) {
    const parent = tree.indices.nodeId[node.parentId];
    const siblings = parent.children;
    const indexCallback = (n) => n === node;
    const nodeIdx = _.findIndex(siblings, indexCallback);
    if (nodeIdx) {
      siblings.splice(0, 0, siblings.splice(nodeIdx, 1)[0]);
    }
    node = parent;
  }
}

export function setGeneOfInterest(tree, geneId) {
  let node = tree.indices.geneId[geneId];
  pivotBranches(tree,node);
  // colorByDistance(tree);
}

export function expandToGenes(tree, genesOfInterest, hideCousins) {
  if (hideCousins) {
    tree.all().forEach(n => n.displayInfo.expanded = false);
  }

  genesOfInterest.forEach(geneId => {
    let node = tree.indices.geneId[geneId];
    if (node) {
      while (node.parentId) {
        node = tree.indices.nodeId[node.parentId];
        node.displayInfo.expanded = true;
      }
    }
  });
  if (!tree.displayInfo.expanded) { // no genesOfInterest in the tree, show everything
    const traverse = node => {
      node.displayInfo.expanded = true;
      node.children && node.children.forEach(child => {
        traverse(child);
      })
    };
    traverse(tree);
  }
  setGeneOfInterest(tree, genesOfInterest[0]);
}

export function indexVisibleNodes(tree) {
  let visibleUnexpanded = []; // array of unexpanded nodes that are visible
  let visibleNodes = [];
  let maxExpandedDist = 0;
  function calcVIndexFor(node) {
    visibleNodes.push(node);
    if (node.scaledDistanceToRoot > maxExpandedDist) {
      maxExpandedDist = node.scaledDistanceToRoot
    }
    if (node.displayInfo.expanded && node.children && node.children.length > 0) {
      if (node.children.length === 2) {
        let leftExtrema = calcVIndexFor(node.children[0]); // left child
        let rightExtrema = calcVIndexFor(node.children[1]); // right child
        node.vindex = (rightExtrema.min + leftExtrema.max) / 2; // midpoint
        return {
          min: leftExtrema.min,
          max: rightExtrema.max
        };
      }
      else {
        let childExtrema = calcVIndexFor(node.children[0]);
        node.vindex = node.children[0].vindex;
        return {
          min: childExtrema.min,
          max: childExtrema.max
        };
      }
    }
    else {
      visibleUnexpanded.push(node);
      node.vindex = visibleUnexpanded.length;
      return {
        min: node.vindex,
        max: node.vindex
      };
    }
  }

  let maxVIndex = calcVIndexFor(tree).max;
  return {maxExpandedDist, visibleNodes, visibleUnexpanded, maxVIndex}
}

export function addConsensus(tree) {
  // generate a consensus sequence and coverage for each node in the tree
  // for leaf nodes use the sequence and cigar attributes to define the node's consensus
  // for internal nodes (2 children) select the consensus based on the frequency in the child nodes
  if (tree.consensus) return;

  let clength = 0;

  function cigarToConsensus(cigar, seq) {

    let pieces = cigar.split(/([DM])/);
    let stretch=0;
    if (clength === 0) {
      pieces.forEach(function (piece) {
        if (piece === "M" || piece === "D") {
          if (stretch === 0) stretch = 1;
          clength += stretch;
        }
        else {
          stretch = +piece;
        }
      });
      stretch = 0;
    }
    let seqOffset=0;
    let alignOffset = 0;
    let frequency = new Uint16Array(clength);
    let coverage = new Uint16Array(clength);
    let alignSeqArray = new Uint16Array(clength);


    pieces.forEach(function (piece) {
      if (piece === "M") {
        if (stretch === 0) stretch = 1;
        frequency.fill(1, alignOffset, alignOffset + stretch);
        coverage.fill(1, alignOffset, alignOffset + stretch);
        for(let i=0; i<stretch; i++) {
          alignSeqArray[alignOffset++] = seq.charCodeAt(seqOffset++);
        }
        stretch = 0;
      }
      else if (piece === "D") {
        if (stretch === 0) stretch = 1;
        alignSeqArray.fill(45, alignOffset, alignOffset + stretch);
        alignOffset += stretch;
        stretch = 0;
      }
      else if (!!piece) {
        stretch = +piece;
      }
    });
    return {alignSeqArray: alignSeqArray, frequency: frequency, coverage: coverage, nSeqs: 1};
  }

  function mergeConsensi(A,B) {
    // const clength = A.coverage.length;
    let frequency = new Uint16Array(clength);
    let coverage = new Uint16Array(clength);
    let alignSeqArray = new Uint16Array(clength);
    frequency.set(A.frequency);
    coverage.set(A.coverage);
    alignSeqArray.set(A.alignSeqArray);
    let res = {
      alignSeqArray: alignSeqArray,
      frequency: frequency,
      coverage: coverage,
      nSeqs: A.nSeqs + B.nSeqs
    };
    for(let i=0; i<clength; i++) {
      res.coverage[i] += B.coverage[i];
      if (B.alignSeqArray[i] === res.alignSeqArray[i]) {
        res.frequency[i] += B.frequency[i];
      }
      else if (B.frequency[i] > res.frequency[i]) {
        res.frequency[i] = B.frequency[i];
        res.alignSeqArray[i] = B.alignSeqArray[i];
      }
    }
    return res;
  }

  function addConsensusToNode(node) {
    if (node.sequence && node.cigar) {
      node.consensus = cigarToConsensus(node.cigar, node.sequence);
    }
    else if (node.children.length === 1) {
      addConsensusToNode(node.children[0]);
      node.consensus = node.children[0].consensus;
    }
    else if (node.children.length === 2) {
      addConsensusToNode(node.children[0]);
      addConsensusToNode(node.children[1]);
      node.consensus = mergeConsensi(node.children[0].consensus, node.children[1].consensus);
    }
    else {
      // tree doesn't have MSA
      node.consensus = cigarToConsensus('M','X');
    }
  }

  function addHeatmap(node) {
    let heatmap = new Uint16Array(clength);
    const nSeqs = node.consensus.nSeqs;
    node.consensus.coverage.forEach((c,i) => {
      heatmap[i] = c > 0 ? 42 - Math.ceil(9*c/nSeqs) : 42;
    });
    node.consensus.heatmap = heatmap;
    node.children && node.children.forEach(child => {
      addHeatmap(child);
    });
  }

  addConsensusToNode(tree);
  addHeatmap(tree);
}

export function makeMask(gaps, totalLength) {
  // the complement of the gaps is the mask we want to return
  // so now pos and len refer to non-gap intervals
  let pos = 0;
  let len = 0;
  let mask = [];
  let maskLen=0;
  gaps.filter(gap => gap.collapsed).forEach(gap => {
    len = gap.offset - pos;
    if (len > 0) {
      maskLen += len;
      mask.push({
        offset: pos,
        len: len
      });
    }
    pos = gap.offset + gap.len;
  });
  if (pos < totalLength) {
    len = totalLength - pos;
    maskLen += len;
    mask.push({
      offset: pos,
      len: len
    })
  }

  let starts = new Uint16Array(mask.length);
  let offsets = new Uint16Array(mask.length);
  let posInSeq=0;
  mask.forEach((region,idx) => {
    offsets[idx] = region.offset;
    starts[idx] = posInSeq;
    posInSeq += region.len;
  });

  return ({gaps, mask, maskLen, starts, offsets});
}

export function getGapMask(node, minDepth, minGapLength, gapPadding) {
  if (!node.consensus) return;
  if (minGapLength < 3) gapPadding = 0;

  const coverage = node.consensus.coverage;
  let gaps = [];
  let pos = 0;
  let len = 0;
  let maxCoverage = 0;
  for(let i=0; i<coverage.length; i++) {
    if (coverage[i] < minDepth) {
      if (coverage[i] > maxCoverage) {
        maxCoverage = coverage[i];
      }
      len++;
    }
    else {
      if (len >= minGapLength) {
        gaps.push({
          offset: pos + gapPadding,
          len: len - 2*gapPadding,
          coverage: maxCoverage,
          collapsed: true
        });
        maxCoverage = 0;
      }
      pos = i + 1;
      len = 0;
    }
  }
  if (len >= minGapLength) {
    gaps.push({
      offset: pos + gapPadding,
      len: len - 2 * gapPadding,
      coverage: maxCoverage,
      collapsed: true
    })
  }
  return makeMask(gaps, coverage.length);
}

function maxOverlaps(regions) {
  regions.sort((a,b) => a.coverage - b.coverage);
  let results = [];
  while(regions.length > 0) {
    let a = regions.pop(); // region with highest coverage
    if (results.length === 0) {
      results.push(a);
    }
    else {
      let merged = [];
      let pushA = true;
      while(results.length > 0) {
        let b = results.shift();
        if (a.end <= b.start) {
          merged.push(a, b);
          pushA = false;
          while (results.length > 0) {
            merged.push(results.shift());
          }
        }
        else if (a.start >= b.end) {
          merged.push(b);
        }
        else {
          // a and b overlap
          if (a.start < b.start) {
            if (a.end > b.end) {
              let c = _.clone(a);
              c.start = b.end;
              regions.push(c);
            }
            a.end = b.start;
            merged.push(a,b);
            pushA = false;
            while (results.length > 0) {
              merged.push(results.shift());
            }
          }
          else if (a.end > b.end) {
            a.start = b.end;
            merged.push(b);
          }
        }
      }
      if (pushA) merged.push(a);
      results = merged;
    }
  }
  return results;
}

function flattenRegions(regions) {
  regions.sort((a,b) => a.start - b.start);
  let results = [];
  while (regions.length > 0) {
    let a = regions.shift();
    let merged = [];
    while (results.length > 0) {
      let b = results.shift();
      if (b.end <= a.start) {
        merged.push(b);
      }
      else if (b.start >= a.end) {
        merged.push(a,b);
        while(results.length > 0) {
          merged.push(results.shift());
        }
      }
      else {
        if (a.start < b.start) {
          let c = _.clone(a);
          c.end = b.start;
          merged.push(c);
        }
        if (a.start > b.start) {
          let c = _.clone(b);
          c.end = a.start;
          merged.push(c);
        }
        if (a.end < b.end) {
          if (a.id === b.id) {
            a.coverage += b.coverage;
          }
          merged.push(a);
          b.start = a.end;
          merged.push(b);
          while(results.length > 0) {
            merged.push(results.shift());
          }
        }
        else if (a.end > b.end) {
          if (a.id === b.id) {
            b.coverage += a.coverage;
          }
          merged.push(b);
          a.start = b.end;
        }
        else {
          if (a.id === b.id) {
            a.coverage += b.coverage;
          }
          merged.push(a);
          while(results.length > 0) {
            merged.push(results.shift());
          }
        }
      }
    }
    results = merged;
  }
  return results;
}

export function mergeOverlaps(regions, minOverlap, coverageMode) {
  if (coverageMode === 'maxm') {
    return maxOverlaps(regions);
  }
  if (coverageMode === 'sumd') {
    return flattenRegions(regions);
  }
  regions.sort((a,b) => a.start - b.start);
  let clusters = [];
  let ipr = regions.shift();
  let cluster = {
    start: ipr.start,
    end: ipr.end,
    id: ipr.id,
    coverage: ipr.coverage
  };
  let startNewCluster = false;
  regions.forEach(ipr => {
    startNewCluster = true;
    if (ipr.start <= cluster.end) {
      if (ipr.end <= cluster.end) { // ipr completely contained in cluster
        if (coverageMode === 'max' && ipr.id !== cluster.id) {
          let middleCluster = _.clone(ipr);
          let nextCluster = _.clone(cluster);
          nextCluster.start = middleCluster.end;
          cluster.end = middleCluster.start;
          clusters.push(cluster);
          clusters.push(middleCluster);
          cluster = nextCluster;
        }
        startNewCluster = false;
        if (coverageMode === 'sum') cluster.coverage += ipr.coverage;
      }
      else { // ipr extends beyond end of cluster
        let overlap = cluster.end - ipr.start;
        if (overlap/(ipr.end - ipr.start) >= minOverlap
          || overlap/(cluster.end - cluster.start) >= minOverlap) {
          if (coverageMode === 'max' && ipr.id !== cluster.id) {
            if (cluster.coverage > ipr.coverage) {
              ipr.start = cluster.end;
            }
            else {
              cluster.end = ipr.start;
            }
          }
          else {
            cluster.end = ipr.end;
            if (coverageMode === 'sum') cluster.coverage += ipr.coverage;
            if (coverageMode === 'max' && ipr.coverage > cluster.coverage) cluster.coverage = ipr.coverage;
            startNewCluster = false;
          }
        }
      }
    }
    if (startNewCluster) {
      clusters.push(cluster);
      cluster = {
        start: ipr.start,
        end: ipr.end,
        id: ipr.id,
        coverage: ipr.coverage
      };
    }
  });
  clusters.push(cluster);
  return clusters;
}

// find index of first element in arr that is <= x
// arr is strictly increasing
export function lowerBound(a,b,arr,x) {
  while (a < b) {
    let m = (a + b) >> 1;
    if (arr[m] < x) {
      if (a === m) {
        return (arr[b] < x) ? b : a;
      }
      else {
        a = m;
      }
    }
    else if (arr[m] > x) {
      b = m - 1;
    }
    else {
      return m;
    }
  }
  return a;
}

// 1. walk the tree and gather all of the interpro ids as keys in an object
// 2. fetch the records from the API
// 3. walk the tree again and set the domains field
export function addDomainArchitecture(tree, api, callback) {
  if (tree.domainArchitecture) return;
  // 1. walk the tree and gather all of the interpro ids as keys in an object
  let idSet = {};
  const setupInterpro = node => {
    if (node.interpro) {
      node.interpro.forEach(ipr => {
        idSet[ipr.id] = 'x';
        ipr.start--; // convert to half-open intervals
      });
    }
    node.children && node.children.forEach(child => {
      setupInterpro(child);
    });
  };
  setupInterpro(tree);
  let idList = Object.keys(idSet);
  let params = {
    setId: 'interpro_71',
    q: 'id:(' + idList.join(' ') + ')',
    rows: idList.length
  };
  // 2. fetch the records from the API
  api.execute({operationId: 'search', parameters: params}).then(res => {
    let domainIdx = _.keyBy(res.body,'id');
    // 3. walk the tree again and set the domainArchitecture field
    function doMerge(group1, group2) {
      let merged = _.clone(group1);
      Object.keys(group2).forEach(nodeType => {
        if(merged[nodeType]) {
          merged[nodeType] = doSetMerge(merged[nodeType],group2[nodeType]);
        }
        else {
          merged[nodeType] = group2[nodeType]
        }
      });
      return merged;
    }
    function doSetMerge(set1, set2) {
      let merged = _.cloneDeep(set1);
      Object.keys(set2).forEach(root => {
        if (merged[root]) {
          merged[root].nSeqs += set2[root].nSeqs;
          merged[root].hits = mergeOverlaps(_.concat(merged[root].hits,set2[root].hits), 0.2, 'sum');
        }
        else {
          merged[root] = set2[root]
        }
      });
      return merged;
    }
    function projectToMSA(region, startPositions, mask) {
      let lb1 = lowerBound(0,   startPositions.length-1, startPositions, region.start);
      let lb2 = lowerBound(lb1, startPositions.length-1, startPositions, region.end-1);
      return {
        id:    region.id,
        coverage: region.coverage,
        start: mask[lb1].offset + region.start - startPositions[lb1],
        end:   mask[lb2].offset + region.end   - startPositions[lb2]
      }
    }
    function leafDomains(node) {
      if (!node.hasOwnProperty('interpro')) return {};
      // group by nodeType and hierarchy root
      let groups = {};
      node.interpro.forEach(hit => {
        let domain = domainIdx[hit.id];
        hit.coverage = 1;
        if (domain) {
          if (!groups.hasOwnProperty(domain.nodeType)) {
            groups[domain.nodeType] = {};
          }
          if (!groups[domain.nodeType].hasOwnProperty(domain.treeId)) {
            groups[domain.nodeType][domain.treeId] = {
              hits: [],
              nSeqs: 1
            };
          }
          groups[domain.nodeType][domain.treeId].hits.push(hit);
        }
      });
      // sort domains within each group by start pos
      // merge if overlap by at least 20% of the shorter one
      // also convert domain positions from sequence to MSA
      const gaps = getGapMask(node,1,1,0); // use this function to mark the regions in the msa
      let startPositions = new Uint16Array(gaps.mask.length); // do binary search on this
      let posInSeq=0;
      gaps.mask.forEach((region,idx) => {
        startPositions[idx] = posInSeq;
        posInSeq += region.len;
      });
      _.each(groups,(group,nodeType) => {
        _.each(group,(set,rootId) => {
          set.hits = mergeOverlaps(set.hits, 0.2)
            .map(region => projectToMSA(region, startPositions, gaps.mask));
        });
      });
      return groups;
    }
    function mergeDomains(node) {
      let domains = [];
      if (!node.children || node.children.length === 0) {
        domains = leafDomains(node);
      }
      else {
        domains = mergeDomains(node.children[0]);
        for(let i=1;i<node.children.length;i++) {
          domains = doMerge(domains, mergeDomains(node.children[i]));
        }
      }
      node.domainArchitecture = domains;
      if (domains.hasOwnProperty('Domain')) {
        let domainHits=[];
        Object.keys(domains.Domain).forEach(rootId => {
          Array.prototype.push.apply(domainHits,domains.Domain[rootId].hits);
        });
        domainHits = mergeOverlaps(domainHits,0,'maxm');
        node.domainHits = domainHits;
        domainHits.forEach(dh => {
          const domain = domainIdx[dh.id];
          for(let i=dh.start; i<=dh.end; i++) {
            if (node.consensus.heatmap[i] < 43) {
              node.consensus.heatmap[i] += domain.colorOffset;
            }
          }
        })
      }
      return domains;
    }
    let colors = d3chrom.schemeCategory10;
    const nColors = 8;
    _.each(domainIdx, (ipr,id) => {
      let colorIdx = ipr.rootId % 10;
      let full = colors[colorIdx];
      let pale = d3.scaleLinear().domain([0,1]).range(['#FFFFFF',full])(0.5);
      ipr.colorScale = d3.scaleLinear().domain([0, 1]).range([pale,full]);
      ipr.colorOffset = (ipr.rootId % nColors + 1) * 10;
    });

    let rootDomains = mergeDomains(tree);

    callback(domainIdx, rootDomains);
  }).catch((error) => {
    console.log('error searching',params,error);
  });
}