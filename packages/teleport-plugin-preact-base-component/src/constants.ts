import { UIDLDependency } from '@teleporthq/teleport-types'

export const PREACT_COMPONENT_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'preact',
  version: 'next',
  meta: {
    namedImport: true,
  },
}

export const DEFAULT_COMPONENT_CHUNK_NAME = 'jsx-component'

export const DEFAULT_EXPORT_CHUNK_NAME = 'export'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'
