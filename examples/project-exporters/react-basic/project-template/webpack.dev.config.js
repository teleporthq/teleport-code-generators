/* tslint:disable */
/**
 * Clean and copy, used for file operations to copy and clean things in the
 * destination directory. 
 */
const CleanWebpackPlugin = require('clean-webpack-plugin')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')

const { entryPath, distFolder, htmlFile } = require('./bundle-config/paths')

module.exports = {
  /**
   * Configure the entry point that will be the bundle of the entire app
   */
  entry: {
    index: entryPath
  },

  /**
   * Dev, because this only runs in local development mode, there's a separate file
   * config for production/deploys
   */
  mode: 'development',

  /**
   * Specifty where the bundled javascript will be placed. 
   * 
   * Note that the index.html file is placed by a plugin, it is not placed with 
   * this output instruction
   * 
   * Note that the output dir is the same as the one in production, but this output
   * is consumed by the webpack dev server. This means running this config will
   * not create the output dir, it will make an in memory representation of this
   * file.
   */
  output: {
    path: distFolder,
    publicPath: '/',
    filename: '[name].js'
  },

  devServer: {
    /**
     * This is for static files! Not for a url linking the main bundle with a path
     * or anything like that
     */
    contentBase: distFolder,
    compress: true,
    port: 9000,
    lazy: true,
    // https://webpack.js.org/configuration/dev-server/#devserver-filename-
    filename: '[name].js',
    historyApiFallback: true
  },

  /**
   * Parse various different file types with specific plugins that transform the content
   * before it is bundled into the final output
   */
  module: {
    rules: [
      /**
       * Parsed js and jsx file with babel, using the .babelrc file found in the root
       * of the project. 
       */
      { 
        test: /\.jsx?$/, 
        use: {
          loader: 'babel-loader',
        } 
      },

      /**
       * Support css imports as css modules
       */
      {
        test: /\.css$/,
        use: [
          {
            loader: "style-loader"
          },
          {
            loader: 'css-loader',
            options: {
              camelCase: true,
              modules: true
            },
          }
        ]
        
      },
    ]
  },

  plugins: [
    /**
     * Copy the the html file that we have into the destination folder. Also
     * place the name of the output script inside the file, so it points to
     * our latest generated script. This is needed because the name of the
     * script changes every time we bundle, because we add a hash in the name
     * to prevent caching
     */
    new HtmlWebpackPlugin({
      // Load a custom template (lodash by default)
      template: htmlFile
    }),
    new CopyWebpackPlugin([
      { from: './src/static/', to: 'static/' }
    ])
  ]
};