import {
  REQUEST_TREE,
  RECEIVE_TREE,
  USE_TREE,
  CALCULATED_GAPS
} from '../actions/Genetrees'

function trees(
  state = {
    isFetching: false,
    currentTree: '',
    trees: {}
  },
  action
) {
  switch(action.type) {
    case REQUEST_TREE:
      return Object.assign({}, state, {
        isFetching: true,
        currentTree: action.url
      });
    case RECEIVE_TREE:
      const newTree = { ...action.tree,
        visibleNodes: action.visibleNodes,
        maxExpandedDist: action.maxExpandedDist,
        maxVindex: action.maxVindex,
        gaps: {}
      };
      state.trees[state.currentTree] = newTree;

      return Object.assign({}, state, {
        isFetching: false,
        lastUpdated: action.receivedAt,
        interpro: action.interpro,
      });
    case USE_TREE:
      return Object.assign({}, state, {
        currentTree: action.url
      });
    case CALCULATED_GAPS:
      const tree = state.trees[state.currentTree];
      tree.gaps[action.gapKey] = action.gaps
      return Object.assign({}, state);
    default:
      return state
  }
}


export default trees;