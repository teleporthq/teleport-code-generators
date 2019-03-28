export const ASSETS_PREFIX = '/static'
export const LOCAL_DEPENDENCIES_PREFIX = '../components/'
export const DEFAULT_OUTPUT_FOLDER = 'dist'
export const DEFAULT_PACKAGE_JSON = {
  name: 'teleportHQ Project',
  version: '1.0.0',
  description: 'Project generated based on a UIDL document',
  main: 'index.js',
  author: 'teleportHQ',
  license: 'MIT',
  dependencies: {
    next: '^8.0.3',
    'react-dom': '^16.8.3',
    react: '^16.8.3',
  },
  scripts: {
    dev: 'next',
    build: 'next build',
    start: 'next start',
  },
}
