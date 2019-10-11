const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;


module.exports = {
  entry: './src/client.js',
  output: {
    filename: 'bundled.js',
    path: path.resolve(__dirname, 'dist')
  },
  mode: 'production',
  node: {
    fs: 'empty'
  },
  plugins: [
    new BundleAnalyzerPlugin()
  ]
};