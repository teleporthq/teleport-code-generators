import { Mapping } from '@teleporthq/teleport-types'

export const NuxtProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'nuxt-link',
      attrs: {
        to: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
    'html-node': {
      elementType: 'dangerous-html',
      selfClosing: true,
      attrs: {
        shadow: { type: 'static', content: true },
      },
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: 'latest',
        meta: {
          importJustPath: true,
        },
      },
    },
  },
}
