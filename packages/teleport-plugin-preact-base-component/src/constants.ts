import { UIDLDependency } from '@teleporthq/teleport-types'

export const PREACTJSX_PRAGMA_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'preact',
  version: 'next',
  meta: {
    namedImport: true,
  },
}

export const USE_STATE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'preact/hooks',
  version: '16.8.3', // change the version with the template
  meta: {
    namedImport: true,
  },
}

export const DEFAULT_COMPONENT_CHUNK_NAME = 'jsx-component'

export const DEFAULT_EXPORT_CHUNK_NAME = 'export'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'
