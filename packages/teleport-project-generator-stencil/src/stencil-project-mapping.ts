import { Mapping } from '@teleporthq/teleport-types'

export const StencilProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'stencil-route-link',
      dependency: {
        type: 'library',
        path: '@stencil/router',
        version: '1.0.1',
        meta: {
          namedImport: true,
        },
      },
      attrs: {
        url: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
  },
}
