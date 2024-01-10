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
        version: '0.1.13',
        meta: {
          importJustPath: true,
          importAlias: 'https://unpkg.com/dangerous-html/dist/default/lib.umd.js',
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
            'https://github.com/teleporthq/date-time-primitive/blob/main/dist/default/lib.umd.js',
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
