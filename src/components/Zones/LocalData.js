import React from 'react'
import { connect } from 'react-redux'
import myContext from "../../store/context";

const LocalData = props => <pre>LocalData</pre>;
export default connect(null, null, null, {context:myContext})(LocalData);