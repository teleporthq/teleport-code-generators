import { Mapping } from '@teleporthq/teleport-types'

export const GridsomeProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'router-link',
      attrs: {
        to: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.10',
        meta: {
          importAlias: 'dangerous-html/dist/vue/lib.mjs',
        },
      },
    },
  },
}
