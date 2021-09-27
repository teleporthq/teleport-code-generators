import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { parseComponentJSON } from '../../src/parser'

describe('Parses referenced Styles and parsers static or number', () => {
  it('Converts the static values to Static Nodes', () => {
    const componentUIDL = component(
      'MyComponent',
      elementNode('container', {}, [], null, {}, null, {})
    )
    componentUIDL.node.content.referencedStyles = {
      '12345678': {
        type: 'style-map',
        content: {
          mapType: 'component-referenced',
          content: {
            type: 'static',
            content: 'md-8',
          },
        },
      },
    }
    const result = parseComponentJSON(componentUIDL as unknown as Record<string, unknown>)
    // @ts-ignore
    expect(Object.values(result.node.content.referencedStyles)[0].content.content.type).toBe(
      'static'
    )
  })

  it('Throws error if the mapType is invalid', () => {
    const componentUIDL = component(
      'MyComponent',
      elementNode('container', {}, [], null, {}, null, {})
    )
    componentUIDL.node.content.referencedStyles = {
      '12345678': {
        type: 'style-map',
        content: {
          // @ts-ignore
          mapType: 'invalid-type',
          // @ts-ignore
          content: 'md-8',
        },
      },
    }

    expect(() => parseComponentJSON(componentUIDL as unknown as Record<string, unknown>)).toThrow(
      'Un-expected mapType passed in referencedStyles - invalid-type'
    )
  })
})
