import React from 'react'
import { connect } from 'react-redux'

const Tree = props => props.isFetching ? <pre>fetching</pre> : <pre>received</pre>;

const mapState = state => {
  const url = state.genetrees.currentTree;
  return {
    isFetching: state.genetrees.isFetching,
    tree: state.genetrees.trees[url]
  }
};

export default connect(mapState)(Tree);
