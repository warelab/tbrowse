module.exports = {
  type: 'react-component',
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
