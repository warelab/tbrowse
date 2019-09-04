import { createAction, createReducer } from 'redux-starter-kit'
import { zoneDefaults } from "../store/initialState";

const updateZonePosition = createAction('layout/updateZonePosition');
const addZone = createAction('layout/addZone');
const deleteZone = createAction('layout/deleteZone');
const replaceZone = createAction('layout/replaceZone');
const updateZoneParam = createAction('layout/updateZoneParam');
export { addZone, deleteZone, replaceZone, updateZonePosition, updateZoneParam };


const layoutReducer = createReducer({}, {
  [updateZonePosition]: (state, action) => {
    state.zones[action.payload.idx].width = action.payload.width;
    state.zones[action.payload.idx].offset = action.payload.offset;
  },
  [updateZoneParam]: (state, action) => {
    state.zones[action.payload.idx][action.payload.id] = action.payload.value
  },
  [addZone]: (state, action) => { // insert an empty zone to the right of this one
    const idx = action.payload.idx;
    const currentZone = state.zones[idx];
    let newZone = {
      width: 100,
      type: 'tbd',
      offset: currentZone.offset + currentZone.width
    };
    for(let i=idx+1; i<state.zones.length; i++) {
      state.zones[i].offset += 100;
    }
    state.zones.splice(action.payload.idx + 1, 0, newZone);
  },
  [deleteZone]: (state, action) => {
    state.zones.splice(action.payload.idx, 1);
  },
  [replaceZone]: (state, action) => {
    const idx = action.payload.idx;
    if (state.zones[idx].type !== action.payload.type) { // change zone type, but keep width the same
      const width = state.zones[idx].width;
      const offset = state.zones[idx].offset;
      state.zones[idx] = zoneDefaults[action.payload.type];
      state.zones[idx].width = width;
      state.zones[idx].offset = offset;
      state.zones[idx].type = action.payload.type;
    }
  }
});

export default layoutReducer;

