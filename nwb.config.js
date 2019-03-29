module.exports = {
  type: 'react-component',
  karma: {
    extra: {
      failOnEmptyTestSuite: false
    }
  },
  npm: {
    esModules: true,
    umd: {
      global: 'TBrowse',
      externals: {
        react: 'React'
      }
    }
  }
}
