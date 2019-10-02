import {prepTree, addConsensus, getGapMask, makeMask, expandToGenes, indexVisibleNodes, addDomainArchitecture} from '../utils/treeTools'
import Swagger from "swagger-client";

export const REQUESTED_TREE = 'REQUESTED_TREE';
export const RECEIVED_TREE = 'RECEIVED_TREE';
export const USED_TREE = 'USED_TREE';
export const HOVERED_NODE = 'HOVERED_NODE';
export const UPDATED_TREE_LAYOUT = 'UPDATED_TREE_LAYOUT';
export const CALCULATED_GAPS = 'CALCULATED_GAPS';

function requestTree(url) {
  return {
    type: REQUESTED_TREE,
    url
  }
}

function receiveTree(tree, indexes, interpro) {
  return {
    type: RECEIVED_TREE,
    tree, ...indexes, interpro,
    receivedAt: Date.now()
  }
}

const useTree = (url) => {
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
      n.children.forEach(child => makeNodeVisible(child, recursive));
    }
  }
  makeNodeVisible(node, recursive);
  return updateLayout();
};

export const collapseNode = node => {
  node.displayInfo.expanded = false;
  return updateLayout();
};

const treeURL = (p,s) => `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;

export const getGapParams = (p) => [p.minDepth, p.minGapLength, p.gapPadding];

function saveGaps(gapKey, gaps) {
  return {
    type: CALCULATED_GAPS,
    gaps, gapKey
  }
}

function deleteAlignSeq(tree) {
  Object.values(tree.indices.nodeId).forEach(node => {
    if (node.model.consensus.hasOwnProperty('alignSeq')) {
      delete node.model.consensus.alignSeq;
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
    dispatch(saveGaps(gapKey, makeMask(gaps, tree.model.consensus.coverage.length)));
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
        let tree = prepTree(json, state.genetrees.nodeHeight);
        expandToGenes(tree, params.genesOfInterest || state.genetrees.genesOfInterest, false);
        let indexes = indexVisibleNodes(tree);

        addConsensus(tree);

        Swagger(`${state.genetrees.api}/swagger`)
          .then(client => {
            addDomainArchitecture(tree, client, function (interpro) {
              dispatch(receiveTree(tree, indexes, interpro));
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
