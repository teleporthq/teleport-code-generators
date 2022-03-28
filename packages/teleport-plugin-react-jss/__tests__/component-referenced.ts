import { createReactJSSPlugin } from '../src'
import { staticNode, elementNode, component } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createComponentChunk } from './mocks'

describe('Component Scoped Styles', () => {
  const uidl = component('MYComponent', elementNode('container', {}, [], null, {}), {}, {})
  uidl.styleSetDefinitions = {
    'primary-navbar': {
      type: 'reusable-component-style-map',
      content: {
        width: staticNode('100px'),
        height: staticNode('200px'),
      },
    },
    secondaryNavbar: {
      type: 'reusable-component-style-map',
      content: {
        height: staticNode('50px'),
        width: staticNode('50px'),
      },
    },
  }

  it('Generates component-scoped style sheet', async () => {
    const plugin = createReactJSSPlugin()
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks } = await plugin(structure)
    const styleChunk = chunks.find((chunk) => chunk.name === 'jss-style-definition')
    const expression = styleChunk.content.declarations[0].init
    const properties = expression.arguments[0].properties

    expect(styleChunk).toBeDefined()
    expect(expression.callee.name).toBe('createUseStyles')
    expect(properties.length).toBe(2)
    expect(properties[0].key.value).toBe('primaryNavbar')
    expect(properties[1].key.value).toBe('secondaryNavbar')
  })

  it(`Generates Component-scoped style sheet and adds to the node`, async () => {
    const plugin = createReactJSSPlugin()
    uidl.node.content.referencedStyles = {
      '12345678': {
        type: 'style-map',
        content: {
          mapType: 'component-referenced',
          content: staticNode('md-8'),
        },
      },
      '1415161718': {
        type: 'style-map',
        content: {
          mapType: 'component-referenced',
          content: {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: 'variant',
            },
          },
        },
      },
    }
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }

    const { chunks } = await plugin(structure)
    const jsxComp = chunks.find((chunk) => chunk.name === 'jsx-component')
    const attrs = jsxComp.meta.nodesLookup.container.openingElement.attributes[0]
    const attrExpressions = attrs.value.expression.expressions

    expect(attrs.value.expression.quasis.length).toBe(3)
    expect(attrExpressions.length).toBe(2)
    expect(attrExpressions[0].property.name).toBe("'md-8'")
    expect(attrExpressions[1].object.name).toBe('classes')
    expect(attrExpressions[1].property.object.name).toBe('props')
    expect(attrExpressions[1].property.property.name).toBe('variant')
  })
})
