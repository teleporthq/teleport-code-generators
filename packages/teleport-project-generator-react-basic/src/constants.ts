export const ASSETS_PREFIX = '/static'

export const DEFAULT_SRC_FILES_PATH = ['src']
export const DEFAULT_ASSET_FILES_PATH = ['src', 'static']
export const DEFAULT_COMPONENT_FILES_PATH = ['src', 'components']
export const DEFAULT_PAGE_FILES_PATH = ['src', 'pages']
export const DEFAULT_STATIC_FILES_PATH = ['src', 'static']

export const DEFAULT_PACKAGE_JSON = {
  name: 'basic-react-app',
  version: '1.0.0',
  description: '',
  main: 'index.js',
  scripts: {
    build: 'webpack',
    dev: 'webpack && webpack-dev-server --config webpack.dev.config',
  },
  author: 'teleportHQ',
  license: 'MIT',
  dependencies: {
    react: '16.8.3',
    'react-dom': '16.8.3',
    'react-router-dom': '4.3.1',
  },
  devDependencies: {
    '@babel/core': '7.3.3',
    '@babel/plugin-syntax-jsx': '7.2.0',
    '@babel/plugin-transform-react-display-name': '7.2.0',
    '@babel/plugin-transform-react-jsx': '7.3.0',
    '@babel/preset-env': '7.3.1',
    babel: '6.23.0',
    'babel-loader': '8.0.5',
    'clean-webpack-plugin': '1.0.1',
    'copy-webpack-plugin': '5.0.0',
    'html-webpack-plugin': '3.2.0',
    'css-loader': '2.1.0',
    'style-loader': '0.23.1',
    'webpack-cli': '3.2.3',
    'webpack-dev-server': '3.2.0',
    webpack: '4.29.5',
  },
}
