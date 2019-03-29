import React from 'react'
import { Provider } from 'react-redux'
import { configureStore } from 'redux-starter-kit'
import Layout from './components/Layout'
import configureState from './initialState.js'
import reducer from './reducers'

const TBrowse = (props) => {
  const store = configureStore({
    reducer: reducer,
    preloadedState: configureState(props)
  });
  
  return (
    <Provider store={store}>
      <Layout/>
    </Provider>
  )
}

export default TBrowse
