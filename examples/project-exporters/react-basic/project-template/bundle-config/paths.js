const path = require('path')

/**
 * Define various paths that the projects needs to take into account when bundling
 */
module.exports = {
  distFolder: path.resolve(__dirname, '../dist'),
  entryPath: path.resolve(__dirname, '../src/index.js'),
  htmlFile: path.resolve(__dirname, '../src/index.html')
}