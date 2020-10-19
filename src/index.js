import React from 'react'
import { Provider } from 'react-redux'
import Layout from './components/Layout'
import 'font-awesome/css/font-awesome.min.css'

import configureStore from './store/configureStore';
import initializeState from './store/initialState.js'
import { fetchTreeIfNeeded } from "./actions/Genetrees";
import myContext from './store/context';
myContext.displayName = 'TBrowse';
const TBrowse = (props) => {
  const store = configureStore(initializeState(props));
  store.dispatch(fetchTreeIfNeeded({}));
  return (
    <Provider context={myContext} store={store}>
      <Layout/>
    </Provider>
  )
}

export default TBrowse
