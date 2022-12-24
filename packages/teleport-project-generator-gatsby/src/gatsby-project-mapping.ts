import { Mapping } from '@teleporthq/teleport-types'

export const GatsbyProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'Link',
      dependency: {
        type: 'library',
        path: 'gatsby',
        version: '^2.15.36',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        to: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.11',
        meta: {
          importAlias: 'dangerous-html/react',
        },
      },
    },
  },
}
