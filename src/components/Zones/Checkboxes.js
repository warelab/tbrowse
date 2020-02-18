import React from 'react'
import { connect } from 'react-redux'
import myContext from "../../store/context";

const Checkboxes = props => <pre>Checkboxes</pre>;
export default connect(null, null, null, {context:myContext})(Checkboxes);
