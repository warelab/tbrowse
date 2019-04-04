import {
  REQUEST_TREE,
  RECEIVE_TREE
} from '../actions/Genetrees'

function trees(
  state = {
    isFetching: false,
    trees: {}
  },
  action
) {
  switch(action.type) {
    case REQUEST_TREE:
      return Object.assign({}, state, {
        isFetching: true})
    case RECEIVE_TREE:
      state.trees[action.url] = {
        tree: action.tree,
        visible: action.visible,
        maxVindex: action.maxVindex,
        interpro: action.interpro
      };
      return Object.assign({}, state, {
        isFetching: false,
        currentTree: action.url,
        lastUpdated: action.receivedAt
      });
    default:
      return state
  }
}


export default trees;