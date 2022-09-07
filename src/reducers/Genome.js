import {
  REQUESTED_ENSEMBL_FEATURES,
  RECEIVED_ENSEMBL_FEATURES
} from '../actions/EnsemblRESTAPI'

function genomeFeatures(state = {}, action) {
  switch(action.type) {
    case REQUESTED_ENSEMBL_FEATURES:
      // state[action.geneId] = {
      //   status: action.type
      // };
      return Object.assign({}, state);
    case RECEIVED_ENSEMBL_FEATURES:
      action.features.forEach(f => {
        // state[g.id] = {
        //   status: action.type,
        //   ...g,
        //   orthologs
        // }
      });
      return Object.assign({}, state);
    default:
      return state
  }
}


export default genomeFeatures;