import React from 'react'
import { connect } from 'react-redux'
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';
import {bindActionCreators} from "redux";
import { expandNode } from "../../actions/Genetrees";

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

class Tree extends React.Component {
  constructor(props) {
    super(props);
  }
  render() {
    if (this.props.isFetching) {
      return (
        <div className='sweet-loading'>
          <BarLoader
            css={override}
            sizeUnit={"px"}
            size={this.props.width}
            color={'#123abc'}
            loading={this.props.isFetching}
          />
        </div>
      )
    }
    return (
      <a onClick={()=>this.props.expandNode(this.props.tree, true)}>tree</a>

    );
  }
}


const mapState = (state, ownProps) => {
  const zone = state.layout.zones[ownProps.zoneId];
  const url = state.genetrees.currentTree;
  return {
    isFetching: state.genetrees.isFetching,
    tree: state.genetrees.trees[url],
    ...zone
  }
};

const mapDispatch = dispatch => bindActionCreators({ expandNode }, dispatch);

export default connect(mapState, mapDispatch)(Tree);
