const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const HTMLWebpackPlugin = require('html-webpack-plugin')
const NodePolyfillsPlugin = require('node-polyfill-webpack-plugin')

module.exports =  {
  entry: './src/client',
  output: {
    filename: 'bundled.js',
    path: path.resolve(__dirname, 'dist/webpack'),
  },
  resolve: {
    fallback: {
      fs: false,
    },
  },
  mode: 'production',
  plugins: [new NodePolyfillsPlugin(), new BundleAnalyzerPlugin(), new HTMLWebpackPlugin()],
  target: 'web',
  devtool: 'inline-source-map',
}
