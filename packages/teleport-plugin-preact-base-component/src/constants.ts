import { UIDLDependency } from '@teleporthq/teleport-types'

export const PREACTJSX_PRAGMA_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'preact',
  version: '^10.3.2',
  meta: {
    namedImport: true,
  },
}

export const USE_STATE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'preact/hooks',
  version: '^10.3.2',
  meta: {
    namedImport: true,
  },
}

export const DEFAULT_COMPONENT_CHUNK_NAME = 'jsx-component'

export const DEFAULT_EXPORT_CHUNK_NAME = 'export'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'
