export const REQUESTED_ORTHOLOGS = 'REQUESTED_ORTHOLOGS';
export const RECEIVED_ORTHOLOGS = 'RECEIVED_ORTHOLOGS';

function requestOrthologs(geneId) {
  return {
    type: REQUESTED_ORTHOLOGS,
    geneId
  }
}

function receiveOrthologs(genes) {
  return {
    type: RECEIVED_ORTHOLOGS,
    genes
  }
}

const orthologsURL = (geneId, api) => {
  return `${api}/search?q=homology__all_orthologs:${geneId}&fl=id,taxon_id,region,start,end,strand&rows=10000`;
};

const fetchOrthologs = geneId => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch(requestOrthologs(geneId));
    return fetch(orthologsURL(geneId,state.blastologs.api))
      .then(response => response.json())
      .then(json => {
        dispatch(receiveOrthologs(json.response.docs))
      })
  }
};

export const fetchOrthologsIfNeeded = geneId => {
  return (dispatch, getState) => {
    const state = getState();
    if (!state.blastologs.hasOwnProperty(geneId)) {
      return dispatch(fetchOrthologs(geneId))
    }
  }
};
