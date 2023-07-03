import { HTMLMapping } from '@teleporthq/teleport-uidl-resolver'
import { Mapping } from '@teleporthq/teleport-types'

export const PlainHTMLMapping: Mapping = {
  ...HTMLMapping,
  elements: {
    ...HTMLMapping.elements,
    navlink: {
      elementType: 'a',
      attrs: {
        href: { type: 'dynamic', content: { referenceType: 'attr', id: 'transitionTo' } },
      },
    },
    'html-node': {
      elementType: 'dangerous-html',
      dependency: {
        type: 'package',
        path: 'dangerous-html',
        version: '1.0.0',
        meta: {
          importJustPath: true,
          importAlias:
            'https://unpkg.com/@teleporthq/thq-lit-components@1.0.0/dist/thq-lit-components.umd.js',
        },
      },
    },
    'date-time-node': {
      elementType: 'date-time-primitive',
      dependency: {
        type: 'package',
        version: '1.0.0',
        path: 'date-time-primitive',
        meta: {
          importJustPath: true,
          importAlias:
            'https://unpkg.com/@teleporthq/thq-lit-components@1.0.0/dist/thq-lit-components.umd.js',
        },
      },
    },
    'lottie-node': {
      elementType: 'lottie-player',
      dependency: {
        type: 'package',
        path: '@lottiefiles/lottie-player',
        version: '1.5.7',
        meta: {
          importJustPath: true,
          importAlias: 'https://unpkg.com/@lottiefiles/lottie-player@1.6.0/dist/lottie-player.js',
        },
      },
    },
  },
  illegalClassNames: [],
}
