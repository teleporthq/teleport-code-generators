import { Mapping } from '@teleporthq/teleport-types'

export const VueMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.13',
        meta: {
          importAlias: 'dangerous-html/vue',
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
    'lottie-node': {
      elementType: 'lottie-vue-player',
    },
  },
  events: {},
  attributes: {},
}
