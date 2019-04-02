import layoutReducer from './Layout'
import genetreesReducer from './Genetrees'
import { combineReducers } from 'redux'

const rootReducer = combineReducers({
  genetrees: genetreesReducer,
  layout: layoutReducer
});

export default rootReducer;