import layoutReducer from './Layout'
import genetreesReducer from './Genetrees'
import blastologsReducer from './Blastologs'
import genomeFeaturesReducer from './Genome'
import { combineReducers } from 'redux'

const rootReducer = combineReducers({
  genetrees: genetreesReducer,
  blastologs: blastologsReducer,
  genomeFeatures: genomeFeaturesReducer,
  layout: layoutReducer
});

export default rootReducer;