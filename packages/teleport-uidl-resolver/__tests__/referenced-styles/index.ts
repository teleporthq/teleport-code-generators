import { UIDLStyleMediaQueryScreenSizeCondition } from '@teleporthq/teleport-types'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { resolveReferencedStyle } from '../../src/resolvers/referenced-styles'

describe('Resolves referenced styles and sorts media styles in order', () => {
  it('sorts media queries in order', () => {
    const style = {
      width: staticNode('100px'),
    }
    const referencedStyles = {
      '5ed66ec0b98ab344e6299c7d': {
        id: '5ed66ec0b98ab344e6299c7d',
        type: 'style-map' as const,
        content: {
          mapType: 'inlined' as const,
          conditions: [{ conditionType: 'screen-size' as const, maxWidth: 767 }],
          styles: {
            display: staticNode('block'),
          },
        },
      },
      '5ed66ec0b98ab344e6299c7c': {
        id: '5ed66ec0b98ab344e6299c7c',
        type: 'style-map' as const,
        content: {
          mapType: 'inlined' as const,
          conditions: [{ conditionType: 'screen-size' as const, maxWidth: 991 }],
          styles: {
            display: staticNode('block'),
          },
        },
      },
    }
    const element = elementNode('container', null, [], null, style, null, referencedStyles)
    const uidl = component('MyComponent', element)
    resolveReferencedStyle(uidl)
    const styles = Object.values(uidl.node.content.referencedStyles)

    expect(
      (styles[0].content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth
    ).toBe(991)
    expect(
      (styles[1].content.conditions[0] as UIDLStyleMediaQueryScreenSizeCondition).maxWidth
    ).toBe(767)
  })
})
