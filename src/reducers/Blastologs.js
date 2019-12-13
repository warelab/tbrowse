import {
  REQUESTED_ORTHOLOGS,
  RECEIVED_ORTHOLOGS
} from '../actions/Blastologs'

function blastologs(state = {}, action) {
  switch(action.type) {
    case REQUESTED_ORTHOLOGS:
      state[action.geneId] = {
        status: action.type
      };
      return Object.assign({}, state);
    case RECEIVED_ORTHOLOGS:
      const orthologs = action.genes.map(g => g.id);
      action.genes.forEach(g => {
        state[g.id] = {
          status: action.type,
          ...g,
          orthologs
        }
      });
      return Object.assign({}, state);
    default:
      return state
  }
}


export default blastologs;