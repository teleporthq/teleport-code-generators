/* tslint:disable */
const path = require('path')
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
   * Prod because this file is ued for production only
   */
  mode: 'production',

  /**
   * Specifty where the bundled javascript will be placed. Note that the index.html
   * file is placed by a plugin, it is not placed with this output instruction
   */
  output: {
    path: distFolder,
    filename: '[name].js'
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
     * Cleanup the destination folder before we get to do anything
     */
    new CleanWebpackPlugin(distFolder),
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