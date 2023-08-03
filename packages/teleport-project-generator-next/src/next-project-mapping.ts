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
    'html-node': {
      elementType: 'Script',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '0.1.13',
        meta: {
          importAlias: 'dangerous-html/react',
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
