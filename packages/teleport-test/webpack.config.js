import { fileURLToPath } from 'url';
import * as path from 'path'
import { createRequire } from 'module';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import  HTMLWebpackPlugin from 'html-webpack-plugin'
import webpack from 'webpack';

const { ProvidePlugin } = webpack
const { resolve, dirname } = path
const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)


export default  {
  entry: './src/client.mjs',
  output: {
    filename: 'bundled.js',
    path: resolve(__dirname, 'dist-webpack')
  },
  resolve: {
    fallback: {
      fs: false,
      process: require.resolve('process/browser')
    }
  },
  mode: 'production',
  plugins: [
    new ProvidePlugin({
      process: require.resolve('process/browser')
    }),
    new BundleAnalyzerPlugin(),
    new HTMLWebpackPlugin()
  ],
  target: 'web'
};