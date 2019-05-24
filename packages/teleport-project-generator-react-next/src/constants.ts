export const ASSETS_PREFIX = '/static'

export const DEFAULT_COMPONENT_FILES_PATH = ['components']
export const DEFAULT_PAGE_FILES_PATH = ['pages']
export const DEFAULT_STATIC_FILES_PATH = ['static']

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
