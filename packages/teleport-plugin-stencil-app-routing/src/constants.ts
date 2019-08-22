import { UIDLDependency } from '@teleporthq/teleport-types'

export const STENCIL_CORE_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: '@stencil/core',
  version: '1.1.4',
  meta: {
    namedImport: true,
  },
}

export const DEFAULT_COMPONENT_CHUNK_NAME = 'jsx-component'

export const DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME = 'component-decorator'

export const DEFAULT_IMPORT_CHUNK_NAME = 'import-local'
