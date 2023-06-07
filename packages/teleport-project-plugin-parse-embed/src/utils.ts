import { UIDLExternalDependency } from '@teleporthq/teleport-types'

export type SUPPORTED_PROJECT_TYPES =
  | 'teleport-project-html'
  | 'teleport-project-react'
  | 'teleport-project-next'

export const JS_EXECUTION_DEPENDENCIES: Record<
  SUPPORTED_PROJECT_TYPES,
  Record<string, UIDLExternalDependency>
> = {
  'teleport-project-react': {
    Script: {
      type: 'library',
      path: 'dangerous-html',
      version: '0.1.13',
      meta: {
        importAlias: 'dangerous-html/react',
      },
    },
  },
  'teleport-project-next': {
    Script: {
      type: 'library',
      path: 'next',
      version: '^12.1.0',
      meta: {
        importAlias: 'next/script',
      },
    },
  },
  'teleport-project-html': {
    DangerousHTML: {
      type: 'package',
      path: 'dangerous-html',
      version: '0.1.13',
      meta: {
        importJustPath: true,
        importAlias: 'https://unpkg.com/dangerous-html/dist/default/lib.umd.js',
      },
    },
  },
}
