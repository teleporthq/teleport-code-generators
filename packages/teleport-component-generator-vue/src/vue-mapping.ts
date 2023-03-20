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
    'lottie-node': {
      elementType: 'lottie-vue-player',
    },
  },
  events: {},
  attributes: {},
}
