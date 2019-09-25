import TreeModel from 'tree-model';
import _ from 'lodash';
let d3 = require('d3-scale');
let d3chrom = require('d3-scale-chromatic');


function indexTree(tree, attrs) {
  const MIN_DIST = 0.05;
  const MAX_DIST = 2;

  tree.indices = {};
  attrs.forEach(a => {tree.indices[a] = {}});
  tree.walk(node => {
    node.displayInfo = { expanded : false, height : 21 };

    node.class = node.model.nodeType; // todo: geneOfInterest/orthologs/paralogs

    node.distanceToRoot = (node.parent ? node.parent.distanceToRoot : 0) + node.model.distanceToParent;

    let parentDist = Math.max(node.model.distanceToParent, MIN_DIST);
    node.scaleFactor = 1;
    while (parentDist > MAX_DIST) {
      parentDist /= 10;
      node.scaleFactor *= 10;
    }
    node.scaledDistanceToRoot = (node.parent ? node.parent.scaledDistanceToRoot : 0) + parentDist;
    attrs.forEach(a => {
      let key = node.model[a];
      if (!_.isUndefined(key)) {
        tree.indices[a][key] = node;
      }
    });
  });
}

function sumBranchLengths(node) {
  let sum = node.model.distanceToParent;
  node.children.forEach(child => {
    sum += sumBranchLengths(child);
  });
  return sum;
}

function flattenTree(node) {
  if (node.children.length === 2) {
    return _.concat(flattenTree(node.children[0]),node,flattenTree(node.children[1]));
  }
  return node;
}

function colorByDistance(tree) {
  let nodeOrder = flattenTree(tree);
  let flatDist = 0;
  nodeOrder.forEach(node => {
    let midpoint = flatDist + node.model.distanceToParent/2;
    node.branchColor = d3chrom.interpolateRainbow(midpoint/tree.totalLength);
    flatDist += node.model.distanceToParent
  });
}

export function prepTree(genetree) {
  function leftIndexComparator(a, b) {
    if (a.leftIndex) {
      return a.leftIndex > b.leftIndex ? 1 : -1;
    }
    else {
      return a.nodeId > b.nodeId ? 1 : -1;
    }
  }
  let tree = new TreeModel({modelComparatorFn: leftIndexComparator}).parse(genetree);
  indexTree(tree, ['geneId','nodeId']);


  tree.totalLength = sumBranchLengths(tree);

  return tree;
}

export function expandToGenes(tree, genesOfInterest) {
  let maxExpandedDist = 0;
  let visibleNodes = [];

  function makeNodeVisible(node) {
    visibleNodes.push(node);
    if (node.scaledDistanceToRoot > maxExpandedDist) {
      maxExpandedDist = node.scaledDistanceToRoot;
    }
  }

  genesOfInterest.forEach(geneId => {
    let node = tree.indices.geneId[geneId];
    if (node) {
      node.displayInfo.expanded = true;
      makeNodeVisible(node);
      node.class = 'geneOfInterest';

      const indexCallback = (n) => n === node;
      while (!node.isRoot()) {
        const parent = node.parent;
        const children = parent.children;
        const nodeIdx = _.findIndex(children, indexCallback);
        if (nodeIdx) {
          children.splice(0,0,children.splice(nodeIdx, 1)[0]);
        }
        node = parent;
        if (!node.displayInfo.expanded) {
          visibleNodes.push(node);
          node.displayInfo.expanded = true;
          node.children.forEach(child => {
            if (!child.displayInfo.expanded) {
              makeNodeVisible(child);
            }
          })
        }
      }
    }
  });
  if (!tree.displayInfo.expanded) { // no genesOfInterest in the tree, show everything
    tree.walk(node => {
      visibleNodes.push(node);
      node.displayInfo.expanded = true;
      if (node.scaledDistanceToRoot > maxExpandedDist) {
        maxExpandedDist = node.scaledDistanceToRoot;
      }
    })
  }
  visibleNodes = _.uniq(visibleNodes);
  colorByDistance(tree);
  return {maxExpandedDist,visibleNodes};
}

export function indexVisibleNodes(tree) {
  let visibleUnexpanded = []; // array of unexpanded nodes that are visible

  function calcVIndexFor(node) {
    if (node.displayInfo.expanded && node.children.length > 0) {

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

  return calcVIndexFor(tree).max;
}

export function addConsensus(tree) {
  // generate a consensus sequence and coverage for each node in the tree
  // for leaf nodes use the sequence and cigar attributes to define the node's consensus
  // for internal nodes (2 children) select the consensus based on the frequency in the child nodes
  if (tree.model.consensus) return;

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
    if (node.model.sequence && node.model.cigar) {
      node.model.consensus = cigarToConsensus(node.model.cigar, node.model.sequence);
    }
    else if (node.children.length === 1) {
      addConsensusToNode(node.children[0]);
      node.model.consensus = node.children[0].model.consensus;
    }
    else if (node.children.length === 2) {
      addConsensusToNode(node.children[0]);
      addConsensusToNode(node.children[1]);
      node.model.consensus = mergeConsensi(node.children[0].model.consensus, node.children[1].model.consensus);
    }
    else {
      // tree doesn't have MSA
      node.model.consensus = cigarToConsensus('M','X');
    }
  }

  addConsensusToNode(tree);
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
  return ({gaps, mask, maskLen});
}

export function getGapMask(node, minDepth, minGapLength, gapPadding) {
  if (!node.model.consensus) return;
  if (minGapLength < 3) gapPadding = 0;

  const coverage = node.model.consensus.coverage;
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
        })
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

export function mergeOverlaps(regions, minOverlap, coverageMode) {
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

// 1. walk the tree and gather all of the interpro ids as keys in an object
// 2. fetch the records from the API
// 3. walk the tree again and set the domains field
export function addDomainArchitecture(tree, api, callback) {
  if (tree.model.domainArchitecture) return;
  // 1. walk the tree and gather all of the interpro ids as keys in an object
  let idSet = {};
  tree.walk(node => {
    if (node.model.interpro) {
      node.model.interpro.forEach(ipr => {
        idSet[ipr.id] = 'x';
        ipr.start--; // convert to half-open intervals
      })
    }
  });
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
      // find index of first element in arr that is <= x
      // arr is strictly increasing
      function lowerBound(a,b,arr,x) {
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
      let lb1 = lowerBound(0,   startPositions.length-1, startPositions, region.start);
      let lb2 = lowerBound(lb1, startPositions.length-1, startPositions, region.end-1);
      return {
        id:    region.id,
        coverage: region.coverage,
        start: mask[lb1].offset + region.start - startPositions[lb1],
        end:   mask[lb2].offset + region.end   - startPositions[lb2]
      };
    }
    function leafDomains(node) {
      if (!node.model.hasOwnProperty('interpro')) return {};
      // group by nodeType and hierarchy root
      let groups = {};
      node.model.interpro.forEach(hit => {
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
      if (node.children.length === 0) {
        domains = leafDomains(node);
      }
      else {
        domains = mergeDomains(node.children[0]);
        for(let i=1;i<node.children.length;i++) {
          domains = doMerge(domains, mergeDomains(node.children[i]));
        }
      }
      node.model.domainArchitecture = domains;
      return domains;
    }
    let rootDomains = mergeDomains(tree);
    let colors = d3chrom.schemeCategory10;
    _.each(domainIdx, (ipr,id) => {
      let colorIdx = ipr.rootId % 10;
      let full = colors[colorIdx];
      let pale = d3.scaleLinear().domain([0,1]).range(['#FFFFFF',full])(0.5);
      ipr.colorScale = d3.scaleLinear().domain([0, 1]).range([pale,full]);
    });
    callback(domainIdx, rootDomains);
  }).catch((error) => {
    console.log('error searching',params,error);
  });
}