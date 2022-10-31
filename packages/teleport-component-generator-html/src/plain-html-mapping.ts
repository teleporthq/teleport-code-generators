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
        version: '0.1.9',
        meta: {
          importJustPath: true,
          importAlias: 'https://unpkg.com/dangerous-html@0.1.9/dist/default/lib.umd.js',
        },
      },
    },
  },
  illegalClassNames: [],
}
