export const ASSETS_PREFIX = '/assets'

export const DEFAULT_SRC_FILES_PATH = ['src']
export const DEFAULT_COMPONENT_FILES_PATH = ['src', 'components']
export const DEFAULT_PAGE_FILES_PATH = ['src', 'views']
export const DEFAULT_PUBLIC_FILES_PATH = ['public']

export const DEFAULT_PACKAGE_JSON = {
  name: 'teleportHQ Project',
  version: '1.0.0',
  description: 'Project generated based on a UIDL document',
  main: 'index.js',
  author: 'teleportHQ',
  license: 'MIT',
  scripts: {
    serve: 'vue-cli-service serve',
    build: 'vue-cli-service build',
  },
  dependencies: {
    vue: '^2.6.7',
    'vue-router': '^3.0.2',
  },
  devDependencies: {
    '@vue/cli-plugin-babel': '^3.4.1',
    '@vue/cli-service': '^3.4.1',
    'vue-template-compiler': '^2.6.7',
  },
  postcss: {
    plugins: {
      autoprefixer: {},
    },
  },
  browserslist: ['> 1%', 'last 2 versions', 'not ie <= 8'],
}
