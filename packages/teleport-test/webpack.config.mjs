import { fileURLToPath } from 'url'
import * as path from 'path'
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import HTMLWebpackPlugin from 'html-webpack-plugin'
import NodePolyfillPlugin from 'node-polyfill-webpack-plugin'
const { resolve, dirname } = path
const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  entry: './src/client.mjs',
  output: {
    filename: 'bundled.js',
    path: resolve(__dirname, 'dist/webpack'),
  },
  resolve: {
    fallback: {
      fs: false,
    },
  },
  mode: 'production',
  plugins: [new NodePolyfillPlugin(), new BundleAnalyzerPlugin(), new HTMLWebpackPlugin()],
  target: 'web',
  devtool: 'inline-source-map',
}
