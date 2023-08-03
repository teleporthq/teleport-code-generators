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
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.13',
        meta: {
          importAlias: 'dangerous-html/dist/vue/lib.js',
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        path: '@teleporthq/react-components',
        version: 'github:teleporthq/thq-react-components#b4a760af6b91e31d182a6a371e55fd984a770d82',
        meta: {
          namedImport: true,
        },
      },
    },
  },
}
