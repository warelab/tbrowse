import {prepTree, prepSpeciesTree, addConsensus, getGapMask, makeMask, expandToGenes, indexVisibleNodes, addDomainArchitecture, initTreeColors, reIndexTree} from '../utils/treeTools'
import Swagger from "swagger-client";

export const REQUESTED_TREE = 'REQUESTED_TREE';
export const RECEIVED_TREE = 'RECEIVED_TREE';
export const USED_TREE = 'USED_TREE';
export const REQUESTED_NEIGHBORS = '  REQUESTED_NEIGHBORS';
export const RECEIVED_NEIGHBORS = 'RECEIVED_NEIGHBORS';
export const USED_NEIGHBORS = 'USED_NEIGHBORS';
export const REQUESTED_SPECIES_TREE = 'REQUESTED_SPECIES_TREE';
export const RECEIVED_SPECIES_TREE = 'RECEIVED_SPECIES_TREE';
export const USED_SPECIES_TREE = 'USED_SPECIES_TREE';
export const HOVERED_NODE = 'HOVERED_NODE';
export const UPDATED_TREE_LAYOUT = 'UPDATED_TREE_LAYOUT';
export const CALCULATED_GAPS = 'CALCULATED_GAPS';
export const COLORING_NEIGHBORS = 'COLORING_NEIGHBORS';
export const USED_COLORS = 'USED_COLORS';
export const COLORED_NEIGHBORS = 'COLORED_NEIGHBORS';
export const CHANGED_GOI = 'CHANGED_GOI';
export const CHANGED_TREE = 'CHANGED_TREE';

function requestTree(url, params) {
  return {
    type: params.speciesTree ? REQUESTED_SPECIES_TREE : REQUESTED_TREE,
    url
  }
}

function receiveTree(tree, params, indexes, interpro) {
  if (params.speciesTree) {
    return {
      type: RECEIVED_SPECIES_TREE,
      tree,
      receivedAt: Date.now()
    }
  }
  return {
    type: RECEIVED_TREE,
    tree, ...indexes, interpro,
    receivedAt: Date.now()
  }
}

const useTree = (url, params) => {
  if (params.speciesTree) {
    return {
      type: USED_SPECIES_TREE,
      url
    }
  }
  return {
    type: USED_TREE,
    url
  }
};

function requestNeighbors(url) {
  return {
    type: REQUESTED_NEIGHBORS,
    url
  }
}

function receiveNeighbors(neighbors) {
  return {
    type: RECEIVED_NEIGHBORS,
    neighbors,
    receivedAt: Date.now()
  }
}

function useNeighbors(url) {
  return {
    type: USED_NEIGHBORS,
    url
  }
}


export const hoverNode = (nodeId) => {
  return dispatch => {
    dispatch( {
      type: HOVERED_NODE,
      nodeId
    })
  }
};

function updateLayout() {
  return (dispatch, getState) => {
    const state = getState();
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    let indexes = indexVisibleNodes(tree);
    dispatch( {
      type: UPDATED_TREE_LAYOUT,
      ...indexes
    })
  }
}

export const expandNode = (node, recursive) => {
  function makeNodeVisible(n, recursive) {
    n.displayInfo.expanded = true;
    if (recursive) {
      n.children && n.children.forEach(child => makeNodeVisible(child, recursive));
    }
  }
  makeNodeVisible(node, recursive);
  return updateLayout();
};

export const collapseNode = node => {
  node.displayInfo.expanded = false;
  return updateLayout();
};

export const swapChildren = node => {
  if (node.children) {
    node.children.push(node.children.shift())
    return updateLayout();
  }
};



const treeURL = (p,s) => {
  let url = `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;
  if (!p.speciesTree && (p.filter || s.filter)) {
    url += `&filter=${p.filter || s.filter}`
  }
  return url;
};

const neighborsURL = (p,s) => {
  let url = `${s.api}/neighbors?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;
  if (!p.speciesTree && (p.filter || s.filter)) {
    url += `&filter=${p.filter || s.filter}`
  }
  return url;
};

export const getGapParams = (p) => [p.minDepth, p.minGapLength, p.gapPadding];

function saveGaps(gapKey, gaps) {
  return {
    type: CALCULATED_GAPS,
    gaps, gapKey
  }
}

function deleteAlignSeq(tree) {
  Object.values(tree.indices.nodeId).forEach(node => {
    if (node.consensus.hasOwnProperty('alignSeq')) {
      delete node.consensus.alignSeq;
    }
    if (node.consensus.hasOwnProperty('alignHist')) {
      delete node.consensus.alignHist;
    }
  });
}
export const calculateGaps = (params) => {
  return (dispatch, getState) => {
    const state = getState();
    const gapParams = getGapParams(params);
    const gapKey = JSON.stringify(gapParams);
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    deleteAlignSeq(tree);
    if (!tree.gaps.hasOwnProperty(gapKey)) {
      dispatch(saveGaps(gapKey, getGapMask(tree, ...gapParams)))
    }
    else {
      Promise.resolve();
    }
  }
};

export const toggleGap = (idx, gapParams) => {
  return (dispatch, getState) => {
    const state = getState();
    const gapKey = JSON.stringify(gapParams);
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    deleteAlignSeq(tree);
    let gaps = tree.gaps[gapKey].gaps;
    if (gaps[idx].collapsed) {
      gaps[idx].collapsed = false;
    }
    else {
      gaps[idx].collapsed = true;
    }
    dispatch(saveGaps(gapKey, makeMask(gaps, tree.consensus.coverage.length)));
  }
};

const shouldFetchTree = (state, url) => {
  if (state.isFetchingTree) return false;
  return !state.trees.hasOwnProperty(url);
};

const shouldFetchNeighbors = (state, url) => {
  if (state.isFetchingNeighbors) return false;
  return !state.neighbors.hasOwnProperty(url);
};

const getGeneOfInterest = state => {
  if (state.genetrees.currentTree && state.genetrees.trees[state.genetrees.currentTree]) {
    let gt = state.genetrees.trees[state.genetrees.currentTree];
    reIndexTree(gt, ['geneId', 'nodeId']);
    return gt.indices.geneId[state.genetrees.genesOfInterest[0]];
  }
  return null;
};

const colorNeighbors = geneId => {
  return (dispatch, getState) => {
    const state = getState();
    const goi = getGeneOfInterest(state);
    if (goi) {
      const neighbors = state.genetrees.neighbors[state.genetrees.currentNeighbors];
      const x = initTreeColors(neighbors, goi);
      dispatch({
        type: COLORED_NEIGHBORS,
        geneId: geneId,
        colors: x
      })
    }
  }
};

const useColors = geneId => {
  return {
    type: USED_COLORS,
    geneId
  }
};

export const colorNeighborsIfNeeded = params => {
  return (dispatch, getState) => {
    const state = getState();
    const goi = getGeneOfInterest(state);
    if (goi && !state.genetrees.treeColors[goi.geneId]) {
      return dispatch(colorNeighbors(goi.geneId));
    }
    else {
      return dispatch(useColors(goi.geneId))
    }
  }
};

const fetchNeighbors = url => {
 return (dispatch, getState) => {
   dispatch(requestNeighbors(url));
   return fetch(url)
     .then(response => response.json())
     .then(json => {
       let neighbors = json;
       dispatch(receiveNeighbors(neighbors))
     })
 }
};

const fetchTree = (url,params) => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch(requestTree(url,params));
    return fetch(url)
      .then(response => response.json())
      .then(json => {
        if (params.speciesTree) {
          const goi = getGeneOfInterest(getState());
          let tree = prepSpeciesTree(json, goi ? goi.taxonId : 0);
          dispatch(receiveTree(tree, params));
        }
        else {
          let tree = prepTree(json, state.genetrees.nodeHeight);
          expandToGenes(tree, params.genesOfInterest || state.genetrees.genesOfInterest, false);
          let indexes = indexVisibleNodes(tree);

          addConsensus(tree);

          Swagger(`${state.genetrees.api}/swagger`)
            .then(client => {
              addDomainArchitecture(tree, client, function (interpro) {
                dispatch(receiveTree(tree, params, indexes, interpro));
                if (tree.hasOwnProperty('speciesTreeId')) {
                  dispatch(fetchTreeIfNeeded({treeId: tree.speciesTreeId, speciesTree: true}));
                }
              })
            })
        }
      })
  }
};

export const fetchTreeIfNeeded = params => {
  return (dispatch, getState) => {
    const state = getState();
    const url = treeURL(params, state.genetrees);
    if (shouldFetchTree(state.genetrees, url)) {
      return dispatch(fetchTree(url,params))
    }
    else {
      return dispatch(useTree(url, params))
    }
  }
};

export const fetchNeighborsIfNeeded = params => {
  return (dispatch, getState) => {
    const state = getState();
    const url = neighborsURL(params, state.genetrees);
    if (shouldFetchNeighbors(state.genetrees, url)) {
      return dispatch(fetchNeighbors(url))
    }
    else {
      return dispatch(useNeighbors(url))
    }
  }
};

export const updateGenesOfInterest = geneIds => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch({
      type: CHANGED_GOI,
      genesOfInterest: geneIds
    });
    // reorganize the tree
    let tree = state.genetrees.trees[state.genetrees.currentTree];
    reIndexTree(tree, ['geneId','nodeId']);
    const goi = tree.indices.geneId[geneIds[0]];
    expandToGenes(tree, geneIds, true);
    dispatch(updateLayout());
    // update the neighborhood colors
    dispatch(colorNeighbors());
    // update species tree colors
    let stree = state.genetrees.trees[state.genetrees.currentSpeciesTree];
    stree = prepSpeciesTree(stree, goi ? goi.taxonId : 0);
    dispatch(receiveTree(stree,{speciesTree:true}))
  }
};

export const newTree = params => {
  return (dispatch, getState) => {
    const state = getState();
    const url = treeURL(params, state.genetrees);
    if (url === state.genetrees.currentTree) {
      // same tree, just update GOI
      dispatch(updateGenesOfInterest(params.genesOfInterest));
    }
    else {
      if (state.genetrees.trees.hasOwnProperty(url)) {
        dispatch(useTree(url,params));
        dispatch(useNeighbors(neighborsURL(params,state.genetrees),params));
        dispatch(updateGenesOfInterest(params.genesOfInterest))
      }
      else {
        dispatch({
          type: CHANGED_TREE,
          genesOfInterest: params.genesOfInterest,
          treeId: params.treeId
        });
        dispatch(fetchTree(url,params))
      }
    }
  }
};