import { createReactStyledComponentsPlugin } from '../src'
import { staticNode, elementNode, component } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, PluginStyledComponent } from '@teleporthq/teleport-types'
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
    const plugin = createReactStyledComponentsPlugin()
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks, dependencies } = await plugin(structure)
    const variantChunk = chunks.find((chunk) => chunk.name === 'variant')
    const declaration = variantChunk.content.declarations[0].init

    expect(chunks.length).toBe(2)
    expect(declaration.callee.name).toBe('variant')
    expect(declaration.arguments[0].properties.length).toBe(2)
    expect(declaration.arguments[0].properties[0].value.value).toBe('compVariant')
    expect(declaration.arguments[0].properties[1].value.properties.length).toBe(2)
    expect(dependencies.variant).toBeDefined()
  })

  it(`Generates Component-scoped style sheet and adds to the node`, async () => {
    const plugin = createReactStyledComponentsPlugin()
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

    const { chunks, dependencies } = await plugin(structure)
    const jsxComp = chunks.find((chunk) => chunk.name === 'jsx-component')
    const attrs = jsxComp.meta.nodesLookup.container.openingElement.attributes[0]

    expect(chunks.length).toBe(3)
    expect(attrs.name.name).toBe('compVariant')
    expect(attrs.value.expression.name).toBe('props.variant')
    expect(dependencies.variant).toBeDefined()
  })

  it(`Throws error when a node is referring to both static component-scoped,
   and dynamic component-scoped`, async () => {
    const plugin = createReactStyledComponentsPlugin()
    uidl.node.content.referencedStyles = {
      ...uidl.node.content.referencedStyles,
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
    }
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }

    expect(plugin(structure)).rejects.toThrow(PluginStyledComponent)
  })
})
