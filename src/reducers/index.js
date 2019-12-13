import layoutReducer from './Layout'
import genetreesReducer from './Genetrees'
import blastologsReducer from './Blastologs'
import { combineReducers } from 'redux'

const rootReducer = combineReducers({
  genetrees: genetreesReducer,
  blastologs: blastologsReducer,
  layout: layoutReducer
});

export default rootReducer;