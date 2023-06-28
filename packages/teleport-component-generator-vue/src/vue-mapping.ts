import { Mapping } from '@teleporthq/teleport-types'

export const VueMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.12',
        meta: {
          importAlias: 'dangerous-html/vue',
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        version: 'github:teleporthq/date-time-primitive',
        path: '@teleporthq/date-time-primitive',
        meta: { importAlias: '@teleporthq/date-time-primitive/vue' },
      },
    },
    'lottie-node': {
      elementType: 'lottie-vue-player',
    },
  },
  events: {},
  attributes: {},
}
