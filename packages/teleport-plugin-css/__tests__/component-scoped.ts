/* tslint:disable no-string-literal */
import { createCSSPlugin } from '../src'
import { staticNode, elementNode, component } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { setUpHASTChunk, setUpJSXComponentChunk } from './mocks'

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
    const plugin = createCSSPlugin({ templateChunkName: 'jsx-component' })
    const structure: ComponentStructure = {
      uidl,
      chunks: [setUpJSXComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks } = await plugin(structure)
    const styleChunk = chunks.find((chunk) => chunk.name === 'style-chunk')

    expect(chunks.length).toBe(2)
    expect(styleChunk).toBeDefined()
    expect(styleChunk.content).toContain(`primary-navbar`)
    expect(styleChunk.content).toContain('secondary-navbar')
  })

  it('Generates style sheet and adds them to the node with JSX template', async () => {
    const plugin = createCSSPlugin({ templateChunkName: 'jsx-component', templateStyle: 'jsx' })
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
      chunks: [setUpJSXComponentChunk()],
      dependencies: {},
      options: {},
    }

    const { chunks } = await plugin(structure)
    const jsxComponent = chunks.find((chunk) => chunk.name === 'jsx-component')

    expect(
      jsxComponent.meta.nodesLookup.container.openingElement.attributes[0].value.expression
        .quasis[0].value.raw
    ).toBe('md-8 primary-navbar ')
    expect(
      jsxComponent.meta.nodesLookup.container.openingElement.attributes[0].value.expression
        .expressions[0].property.name
    ).toBe('variant')
  })

  it('Generates style sheet and adds them to the node with HTML template', async () => {
    const plugin = createCSSPlugin({
      templateChunkName: 'template',
      templateStyle: 'html',
      dynamicVariantPrefix: 'v-bind:class',
    })
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
      chunks: [setUpHASTChunk()],
      dependencies: {},
      options: {},
    }

    const { chunks } = await plugin(structure)
    const hastComponent = chunks.find((chunk) => chunk.name === 'template')

    expect(hastComponent.meta.nodesLookup.container.properties['class']).toBe('md-8 primary-navbar')
    expect(hastComponent.meta.nodesLookup.container.properties['v-bind:class']).toBe('variant')
  })
})
