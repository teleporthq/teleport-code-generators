import { Mapping } from '@teleporthq/teleport-types'

export const PreactProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'Link',
      dependency: {
        type: 'library',
        path: 'preact-router/match',
        version: '2.5.7',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        href: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
  },
}
