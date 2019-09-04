import {
  REQUEST_TREE,
  RECEIVE_TREE,
  USE_TREE,
  HOVER_NODE,
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
        gaps: {},
        highlight: {}
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
    case HOVER_NODE:
      let tree = state.trees[state.currentTree];
      let highlight = {};
      highlight[action.nodeId] = true;
      let hoveredNode = tree.indices.nodeId[action.nodeId];
      hoveredNode.walk(node => {
        highlight[node.model.nodeId] = true;
      });
      while(hoveredNode.parent) {
        hoveredNode = hoveredNode.parent;
        highlight[hoveredNode.model.nodeId] = true;
      }
      tree.highlight = highlight;
      return Object.assign({}, state);
    case CALCULATED_GAPS:
      tree = state.trees[state.currentTree];
      tree.gaps[action.gapKey] = action.gaps;
      return Object.assign({}, state);
    default:
      return state
  }
}


export default trees;