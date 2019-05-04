import layoutReducer from './Layout'
import genetreesReducer from './Genetrees'
// import msaReducer from './MSA'
import { combineReducers } from 'redux'

const rootReducer = combineReducers({
  genetrees: genetreesReducer,
  layout: layoutReducer
  // msa: msaReducer
});

export default rootReducer;