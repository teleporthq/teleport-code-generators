import { Mapping } from '@teleporthq/teleport-types'

export const VueProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'router-link',
      attrs: {
        to: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
  },
}
