export const APP_ROOT_OVERRIDE = '{{ APP }}'
export const ASSETS_PREFIX = '/assets'

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
  scripts: {
    dev: 'nuxt',
    build: 'nuxt build',
    start: 'nuxt start',
    generate: 'nuxt generate',
  },
  dependencies: {
    nuxt: '^2.4.3',
  },
}
