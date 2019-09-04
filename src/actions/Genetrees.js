import {prepTree, addConsensus, getGapMask, expandToGenes, indexVisibleNodes, addDomainArchitecture} from '../utils/treeTools'
import Swagger from "swagger-client";

export const REQUEST_TREE = 'REQUEST_TREE';
function requestTree(url) {
  return {
    type: REQUEST_TREE,
    url
  }
}

export const RECEIVE_TREE = 'RECEIVE_TREE';
function receiveTree(tree, visibleNodes, maxVindex, interpro) {
  return {
    type: RECEIVE_TREE,
    tree, ...visibleNodes, maxVindex, interpro,
    receivedAt: Date.now()
  }
}

export const USE_TREE = 'USE_TREE';
const useTree = (url) => {
  return {
    type: USE_TREE,
    url
  }
};

export const HOVER_NODE = 'HOVER_NODE';
export const hoverNode = (nodeId) => {
  return dispatch => {
    dispatch( {
      type: HOVER_NODE,
      nodeId
    })
  }
};

const treeURL = (p,s) => `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;

export const getGapParams = (p) => [p.minDepth, p.minGapLength, p.gapPadding];

export const CALCULATED_GAPS = 'CALCULATED_GAPS';
function saveGaps(gapKey, gaps) {
  return {
    type: CALCULATED_GAPS,
    gaps, gapKey
  }
}

export const calculateGaps = (params) => {
  return (dispatch, getState) => {
    const state = getState();
    const gapParams = getGapParams(params);
    const gapKey = JSON.stringify(gapParams);
    const tree = state.genetrees.trees[state.genetrees.currentTree];
    if (tree && !tree.gaps.hasOwnProperty(gapKey)) {
      dispatch(saveGaps(gapKey, getGapMask(tree, ...gapParams)))
    }
    else {
      Promise.resolve();
    }
  }
};

const shouldFetchTree = (state, url) => {
  if (state.isFetching) return false;
  return !state.trees.hasOwnProperty(url);
};

const fetchTree = (url,params) => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch(requestTree(url));
    return fetch(url)
      .then(response => response.json())
      .then(json => {
        let tree = prepTree(json);
        let visibleNodes = expandToGenes(tree, params.genesOfInterest || state.genetrees.genesOfInterest);
        let maxVindex = indexVisibleNodes(tree);

        addConsensus(tree);
        // const gapParams = getGapParams(params, state.layout.msa);
        // const gapKey = JSON.stringify(gapParams);
        // const gaps = getGapMask(tree, gapParams);

        Swagger(`${state.genetrees.api}/swagger`)
          .then(client => {
            addDomainArchitecture(tree, client, function (interpro) {
              dispatch(receiveTree(tree, visibleNodes, maxVindex, interpro));
            })
          })
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
      return dispatch(useTree(url))
    }
  }
};
