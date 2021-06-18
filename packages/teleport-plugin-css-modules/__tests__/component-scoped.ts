/* tslint:disable no-string-literal */
import { createCSSModulesPlugin } from '../src'
import { staticNode, elementNode, component } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createComponentChunk } from './mocks'
import { generateStylesFromStyleSetDefinitions } from '../src/utils'

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
    const plugin = createCSSModulesPlugin()
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks } = await plugin(structure)
    const styleChunk = chunks.find((chunk) => chunk.name === 'css-modules')

    expect(chunks.length).toBe(2)
    expect(styleChunk).toBeDefined()
    expect(styleChunk.content).toContain(`primary-navbar`)
    expect(styleChunk.content).toContain('secondaryNavbar')
  })

  it('Generates style sheet and adds them to the node with JSX template', async () => {
    const plugin = createCSSModulesPlugin()
    uidl.node.content.referencedStyles = {
      '12345678': {
        type: 'style-map',
        content: {
          mapType: 'component-referenced',
          content: staticNode('md-8'),
        },
      },
      '910111213': {
        type: 'style-map',
        content: {
          mapType: 'component-referenced',
          content: {
            type: 'dynamic',
            content: {
              referenceType: 'comp',
              id: 'primary-navbar',
            },
          },
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
    const jsxComponent = chunks.find((chunk) => chunk.name === 'jsx-component')
    const jsxExpressions =
      jsxComponent.meta.nodesLookup.container.openingElement.attributes[0].value.expression

    expect(jsxExpressions.quasis.length).toBe(4)
    expect(jsxExpressions.expressions[0].name).toBe("'md-8'")
    expect(jsxExpressions.expressions[1].property.name).toBe("'primary-navbar'")
    expect(jsxExpressions.expressions[2].property.object.name).toBe('props.')
    expect(jsxExpressions.expressions[2].property.property.name).toBe('variant')
  })
})
