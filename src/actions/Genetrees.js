import {prepTree, prepSpeciesTree, addConsensus, getGapMask, makeMask, expandToGenes, indexVisibleNodes, addDomainArchitecture} from '../utils/treeTools'
import Swagger from "swagger-client";
import {reIndexTree} from "../../es/utils/treeTools";

export const REQUESTED_TREE = 'REQUESTED_TREE';
export const REQUESTED_SPECIES_TREE = 'REQUESTED_SPECIES_TREE';
export const RECEIVED_TREE = 'RECEIVED_TREE';
export const USED_TREE = 'USED_TREE';
export const RECEIVED_SPECIES_TREE = 'RECEIVED_SPECIES_TREE';
export const USED_SPECIES_TREE = 'USED_SPECIES_TREE';
export const HOVERED_NODE = 'HOVERED_NODE';
export const UPDATED_TREE_LAYOUT = 'UPDATED_TREE_LAYOUT';
export const CALCULATED_GAPS = 'CALCULATED_GAPS';

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

const treeURL = (p,s) => {
  let url = `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;
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
  // if (state.isFetching) return false;
  return !state.trees.hasOwnProperty(url);
};

const fetchTree = (url,params) => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch(requestTree(url,params));
    return fetch(url)
      .then(response => response.json())
      .then(json => {
        if (params.speciesTree) {
          let goiTaxon = 0;
          if (state.genetrees.currentTree && state.genetrees.trees[state.genetrees.currentTree]) {
            let gt = state.genetrees.trees[state.genetrees.currentTree];
            reIndexTree(gt,['geneId','nodeId']);
            let gene = gt.indices.geneId[state.genetrees.genesOfInterest[0]];
            goiTaxon = gene.taxonId;
          }
          let tree = prepSpeciesTree(json, goiTaxon);
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
