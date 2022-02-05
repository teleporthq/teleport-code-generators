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
  },
  illegalClassNames: [],
}
