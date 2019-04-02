import React from 'react'
import { Provider } from 'react-redux'
import Layout from './components/Layout'

import configureStore from './store/configureStore';
import initializeState from './store/initialState.js'
import { fetchTreeIfNeeded } from "./actions/Genetrees";

const TBrowse = (props) => {
  const store = configureStore(initializeState(props));
  store.dispatch(fetchTreeIfNeeded({}));
  return (
    <Provider store={store}>
      <Layout/>
    </Provider>
  )
}

export default TBrowse
