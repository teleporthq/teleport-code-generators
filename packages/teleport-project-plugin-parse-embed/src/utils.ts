import { UIDLExternalDependency } from '@teleporthq/teleport-types'

export type SUPPORTED_PROJECT_TYPES =
  | 'teleport-project-html'
  | 'teleport-project-react'
  | 'teleport-project-next'
  | 'html'
  | 'jsx'

export const JS_EXECUTION_DEPENDENCIES: Record<string, UIDLExternalDependency> = {
  'teleport-project-react': {
    type: 'library',
    path: 'dangerous-html',
    version: '0.1.13',
    meta: {
      importAlias: 'dangerous-html/react',
    },
  },
  'teleport-project-next': {
    type: 'library',
    path: 'next',
    version: '^12.1.0',
    meta: {
      importAlias: 'next/script',
    },
  },
}
