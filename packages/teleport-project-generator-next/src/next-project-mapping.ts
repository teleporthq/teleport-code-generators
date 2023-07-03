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
    'html-node': {
      elementType: 'DangerousHTML',
      dependency: {
        type: 'package',
        path: '@teleporthq/thq-react-components',
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
        path: '@teleporthq/thq-react-components',
        meta: {
          namedImport: true,
        },
      },
    },
    'lottie-node': {
      elementType: 'lottie-player',
      dependency: {
        type: 'package',
        version: '1.6.0',
        path: '@lottiefiles/lottie-player',
        meta: {
          importJustPath: true,
          needsWindowObject: true,
        },
      },
    },
    fragment: {
      elementType: ' ',
      semanticType: '',
    },
  },
}
