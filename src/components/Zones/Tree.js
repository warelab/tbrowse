import React from 'react'
import { connect } from 'react-redux'
import { css } from '@emotion/core';
import { BarLoader } from 'react-spinners';

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
      <div>tree
      </div>
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

export default connect(mapState)(Tree);
