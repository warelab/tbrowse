import React from 'react'
import {css} from "@emotion/core";
import { BarLoader } from 'react-spinners';

const override = css`
  display: block;
  margin: 0 auto;
  border-color: red;
`;

export const Loading = props => (
  <div className='sweet-loading'>
    <BarLoader
      css={override}
      sizeUnit={"px"}
      size={props.width}
      color={'#123abc'}
      loading={props.isLoading}
    />
  </div>
);
