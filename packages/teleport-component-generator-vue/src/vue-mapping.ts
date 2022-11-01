import { Mapping } from '@teleporthq/teleport-types'

export const VueMapping: Mapping = {
  elements: {
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.10',
        meta: {
          importAlias: 'dangerous-html/vue',
        },
      },
    },
  },
  events: {},
  attributes: {},
}
