export const REQUESTED_ENSEMBL_FEATURES = 'REQUESTED_ENSEMBL_FEATURES';
export const RECEIVED_ENSEMBL_FEATURES = 'RECEIVED_ENSEMBL_FEATURES';

function requestEnsemblFeatures(location, feature_types) {
  return {
    type: REQUESTED_ENSEMBL_FEATURES,
    location: location,
    feature_types: feature_types
  }
}

function receiveEnsemblFeatures(features) {
  return {
    type: RECEIVED_ENSEMBL_FEATURES,
    features
  }
}

const ensemblFeaturesURL = (location, feature_types, api) => {
  return `${api}/overlap/region/${location.system_name}/${location.region}:${location.start}..${location.end}:${location.strand}?content-type=application/json&feature=${feature_types.join('&feature=')}`;
};

const fetchFeatures = (location, feature_types) => {
  return (dispatch, getState) => {
    const state = getState();
    dispatch(requestEnsemblFeatures(location, feature_types));
    return fetch(ensemblFeaturesURL(location,feature_types,state.genome.ensemblAPI))
      .then(response => response.json())
      .then(json => {
        dispatch(receiveEnsemblFeatures(json.response.docs))
      })
  }
};

export const fetchEnsemblFeaturesIfNeeded = (location, feature_types) => {
  return (dispatch, getState) => {
    const state = getState();
    // check if we have the requested features already
    // filter out features we already have and only request what's missing
    // possibly refine the location if we have features from there already
    // if (!state.genome.hasOwnProperty()) {
      return dispatch(fetchFeatures(location, feature_types))
    // }
  }
};
