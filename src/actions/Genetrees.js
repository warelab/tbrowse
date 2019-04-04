import {prepTree, addConsensus, collapseGaps, expandToGenes, indexVisibleNodes, addDomainArchitecture} from '../utils/treeTools'
import Swagger from "swagger-client";

export const REQUEST_TREE = 'REQUEST_TREE';
function requestTree(url) {
  return {
    type: REQUEST_TREE,
    url
  }
}

export const RECEIVE_TREE = 'RECEIVE_TREE';
function receiveTree(url, tree, visible, maxVindex, interpro) {
  return {
    type: 'RECEIVE_TREE',
    url, tree, visible, maxVindex, interpro,
    receivedAt: Date.now()
  }
}

const treeURL = (p,s) => `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;
const gapParams = (p,s) => [p.minDepth || s.minDepth, p.minGapLength || s.minGapLength, p.gapPadding || s.gapPadding];

const shouldFetchTree = (state, params) => {
  if (state.isFetching) return false;
  const url = treeURL(params, state);
  return !state.trees.hasOwnProperty(url);
};

const fetchTree = (params) => {
  return (dispatch, getState) => {
    const state = getState();
    const url = treeURL(params, state.genetrees);
    dispatch(requestTree(url));
    return fetch(url)
      .then(response => response.json())
      .then(json => {
        let tree = prepTree(json);
        addConsensus(tree);
        collapseGaps(tree, gapParams(params, state.genetrees));
        let visible = expandToGenes(tree, params.genesOfInterest || state.genetrees.genesOfInterest);
        let maxVindex = indexVisibleNodes(tree);
        Swagger(`${state.genetrees.api}/swagger`)
          .then(client => {
            addDomainArchitecture(tree, client, function (interpro) {
              dispatch(receiveTree(url, tree.model, visible, maxVindex, interpro));
            })
          })
      })
  }
};

export const fetchTreeIfNeeded = params => {
  return (dispatch, getState) => {
    const state = getState();
    if (shouldFetchTree(state.genetrees, params)) {
      return dispatch(fetchTree(params))
    }
    else {
      return Promise.resolve()
    }
  }
};

