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
        version: '0.1.12',
        meta: {
          importAlias: 'dangerous-html/dist/vue/lib.js',
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        version: 'github:teleporthq/date-time-primitive',
        path: '@teleporthq/date-time-primitive',
        meta: { importAlias: '@teleporthq/date-time-primitive/dist/vue/lib.js' },
      },
    },
  },
}
