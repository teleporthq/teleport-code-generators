import { Mapping } from '@teleporthq/teleport-types'

export const GridsomeProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'router-link',
      attrs: {
        to: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
  },
}
