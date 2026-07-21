import Resolver from '../../src/resolver'
import { HTMLMapping } from '../../src/html-mapping'
import { element, staticNode } from '@teleporthq/teleport-uidl-builders'

/**
 * The Collapsible Text primitive decomposes to plain elements in the UIDL, but
 * its root keeps the semantic `collapsible-text` elementType. Without a base
 * mapping the codegen would emit a literal `<collapsible-text>` custom element,
 * which renders inline (dropping the authored width/box styles) and breaks the
 * `-webkit-line-clamp` overflow measurement the shipped `TqCollapsibleTextOverflow`
 * helper relies on. This locks the primitive -> `div` decomposition in place.
 */
describe('HTMLMapping — primitive decompositions', () => {
  const resolveElementType = (elementType: string): string => {
    const resolver = new Resolver()
    resolver.addMapping(HTMLMapping)
    return resolver.resolveElement(element(elementType, { dummy: staticNode('kept') })).elementType
  }

  it('maps the collapsible-text primitive to a div, not a custom element', () => {
    expect(resolveElementType('collapsible-text')).toBe('div')
  })

  it('keeps the sibling block primitives mapped to div', () => {
    expect(resolveElementType('markdown-node')).toBe('div')
    expect(resolveElementType('rich-text-editor-node')).toBe('div')
  })
})
