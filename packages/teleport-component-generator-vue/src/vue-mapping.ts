import { Mapping } from '@teleporthq/teleport-types'

export const VueMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: '@teleporthq/thq-vue-components',
        version: '1.0.1',
        meta: {
          namedImport: true,
        },
      },
    },
    'date-time-node': {
      elementType: 'DateTimePrimitive',
      dependency: {
        type: 'package',
        version: '1.0.1',
        path: '@teleporthq/thq-vue-components',
        meta: {
          namedImport: true,
        },
      },
    },
    'lottie-node': {
      elementType: 'lottie-vue-player',
    },
  },
  events: {},
  attributes: {},
}
