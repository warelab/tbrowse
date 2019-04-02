export const REQUEST_TREE = 'REQUEST_TREE';
function requestTree(url) {
  return {
    type: REQUEST_TREE,
    url
  }
}

export const RECEIVE_TREE = 'RECEIVE_TREE';
function receiveTree(url, json) {
  return {
    type: 'RECEIVE_TREE',
    url,
    tree: json,
    receivedAt: Date.now()
  }
}

const treeURL = (p,s) => `${s.api}/tree?setId=${p.setId || s.setId}&treeId=${p.treeId || s.treeId}`;

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
      .then(json => dispatch(receiveTree(url, json)))
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

