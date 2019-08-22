import { UIDLDependency } from '@teleporthq/teleport-types'

export const REACT_LIBRARY_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'react',
  version: '16.8.3',
}

export const USE_STATE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'react',
  version: '16.8.3',
  meta: {
    namedImport: true,
  },
}

export const DEFAULT_COMPONENT_CHUNK_NAME = 'jsx-component'

export const DEFAULT_EXPORT_CHUNK_NAME = 'export'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'
