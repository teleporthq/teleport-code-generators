import { Mapping } from '@teleporthq/teleport-types'

export const NextProjectMapping: Mapping = {
  elements: {
    navlink: {
      elementType: 'Link',
      dependency: {
        type: 'library',
        path: 'next/link',
        version: '^12.1.0',
      },
      attrs: {
        href: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
      children: [
        {
          type: 'element',
          content: {
            elementType: 'a',
            name: 'link',
            children: [{ type: 'dynamic', content: { referenceType: 'children', id: 'children' } }],
          },
        },
      ],
    },
  },
}
