import {
  REQUESTED_TREE,
  RECEIVED_TREE,
  USED_TREE,
  HOVERED_NODE,
  UPDATED_TREE_LAYOUT,
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
  let tree;
  switch(action.type) {
    case REQUESTED_TREE:
      return Object.assign({}, state, {
        isFetching: true,
        currentTree: action.url
      });
    case RECEIVED_TREE:
      const newTree = { ...action.tree,
        visibleNodes: action.visibleNodes,
        visibleUnexpanded: action.visibleUnexpanded,
        maxExpandedDist: action.maxExpandedDist,
        maxVindex: action.maxVindex,
        gaps: {},
        highlight: {}
      };
      state.trees[state.currentTree] = newTree;

      return Object.assign({}, state, {
        isFetching: false,
        lastUpdated: action.receivedAt,
        interpro: action.interpro
      });
    case USED_TREE:
      return Object.assign({}, state, {
        currentTree: action.url
      });
    case HOVERED_NODE:
      tree = state.trees[state.currentTree];
      let highlight = {};
      highlight[action.nodeId] = true;
      let hoveredNode = tree.indices.nodeId[action.nodeId];
      const walk = node => {
        highlight[node.nodeId] = true;
        node.children && node.children.forEach(child => {
          walk(child)
        })
      };
      walk(hoveredNode);
      while(hoveredNode.parent) {
        hoveredNode = hoveredNode.parent;
        highlight[hoveredNode.nodeId] = true;
      }
      tree.highlight = highlight;
      return Object.assign({}, state);
    case UPDATED_TREE_LAYOUT:
      tree = state.trees[state.currentTree];
      tree.visibleNodes = action.visibleNodes;
      tree.visibleUnexpanded = action.visibleUnexpanded;
      tree.maxExpandedDist = action.maxExpandedDist;
      tree.maxVindex = action.maxVindex;
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