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
          importAlias: 'https://unpkg.com/dangerous-html@0.1.13/dist/default/lib.umd.js',
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
            'https://cdn.jsdelivr.net/gh/teleporthq/date-time-primitive@3712fd590bd2bb63c5b95228a2f876c809d90349/dist/default/lib.umd.js',
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
    // The UMD build on purpose: the html import plugin emits plain
    // text/javascript script tags, and model-viewer.min.js is an ES module.
    'model-viewer-node': {
      elementType: 'model-viewer',
      dependency: {
        type: 'package',
        path: '@google/model-viewer',
        version: '4.3.1',
        meta: {
          importJustPath: true,
          importAlias: 'https://unpkg.com/@google/model-viewer@4.3.1/dist/model-viewer-umd.min.js',
        },
      },
    },
  },
  illegalClassNames: [],
}
