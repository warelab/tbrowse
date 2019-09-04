import _ from 'lodash';
import Swagger from 'swagger-client';

const genetreesDefaults = {
  api: 'http://www.genetrees.org/api/v1',
  setId: 'compara_95',
  treeId: 'ENSGT00390000003602',
  genomes: [],
  genesOfInterest: ['ENSG00000139618'],
  trees: {}
};
const defaultZones = ['tree', 'label', 'msa'];
const zoneDefaults = {
  tree: {
    genesOfInterest: ['ENSG00000139618'],
    label: 'Tree',
    width: 400,
    minWidth: 100
  },
  msa: {
    label: 'Alignment',
    width: 400,
    minWidth: 100,
    minDepth: 10,
    minGapLength: 1,
    gapPadding: 0,
    colorScheme: 'zappo',
    configurable: [
      {id: 'minDepth', type: 'integer', label: 'Min coverage', min:0, max:100},
      {id: 'minGapLength', type: 'integer', label: 'Min gap length', min:0, max:10},
      {id: 'gapPadding', type: 'integer', label: 'Gap padding', min:0, max:10},
      {id: 'colorScheme', type: 'enum', label: 'Color scheme', values:
        [
          {id: 'clustal', label: 'Clustal'},
          {id: 'zappo', label: 'Zappo'},
          {id: 'taylor', label: 'Taylor'},
          {id: 'hydrophobicity', label: 'Hydrophobicity'},
          {id: 'helix', label: 'Helix Propensity'},
          {id: 'strand', label: 'Strand Propensity'},
          {id: 'turn', label: 'Turn Propensity'},
          {id: 'buried', label: 'Buried Index'}
      ]}
    ]
  },
  label: {
    label: 'Label',
    width: 150,
    minWidth: 10
  },
  distance: {
    label: 'Distance',
    width: 50,
    minWidth: 10
  },
  neighborhood: {
    label: 'Neighborhood',
    width: 400,
    minWidth: 100
  },
  checkbox: {
    label: 'Checkbox',
    width: 50,
    minWidth: 10,
    onChange: (e) => console.log('onChange',e),
    onSave: (e) => console.log('onSave',e)
  },
  local: {
    label: 'Local',
    width: 100,
    minWidth: 10,
    fields: [],
    key: 'tbrowse_test_data'
  }
};

const overrideDefaults = (defaults, props) => {
  let merged = {};
  _.each(defaults, (value, key) => {
    merged[key] = props.hasOwnProperty(key) ? props[key] : value
  });
  return merged;
};

const initializeState = (props) => {
  let state = {
    genetrees: overrideDefaults(genetreesDefaults, props),
    layout: {
      availableZones: Object.keys(zoneDefaults).map(key => {
        return {
          type: key,
          label: zoneDefaults[key].label
        }
      }),
      salt: Math.floor(Math.random() * 1000000).toString(16)
    }
  };
  let offset=0;
  if (!props.zones) {
    state.layout.zones = defaultZones.map(type => {
      let z = _.cloneDeep(zoneDefaults[type]);
      z.type = type;
      z.offset = offset;
      offset += z.width;
      return z;
    })
  }
  else {
    state.layout.zones = props.zones.map(z => {
      if (!zoneDefaults.hasOwnProperty(z.type)) {
        throw('invalid zone type '+z.type);
      }
      let zprops = _.cloneDeep(zoneDefaults[z.type]);
      _.assign(zprops, z);
      zprops.offset = offset;
      offset += zprops.width;
      return zprops;
    })
  }
  return state;
};

export default initializeState;
export { zoneDefaults }
