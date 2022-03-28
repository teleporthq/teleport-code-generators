/* tslint:disable no-string-literal */
import { createReactStyledJSXPlugin } from '../src'
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
    const plugin = createReactStyledJSXPlugin()
    const structure: ComponentStructure = {
      uidl,
      chunks: [createComponentChunk()],
      dependencies: {},
      options: {},
    }
    const { chunks } = await plugin(structure)
    const styles =
      chunks[0].content.declarations[0].init.body.body[0].argument.children[1].children[0]
        .expression.quasis[0].value.raw

    expect(chunks.length).toBe(1)
    expect(styles).toContain('primary-navbar')
    expect(styles).toContain('.secondary-navbar')
  })

  it('Generates style sheet and adds them to the node with JSX template', async () => {
    const plugin = createReactStyledJSXPlugin()
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
    const jsxExpression = jsxComponent.meta.nodesLookup.container.openingElement
    const dynamicExpression = jsxExpression.attributes[0].value.expression.expressions[0]

    expect(jsxExpression.attributes[0].value.expression.quasis[0].value.raw).toContain(
      'md-8 primary-navbar '
    )
    expect(dynamicExpression.object.name).toBe('props')
    expect(dynamicExpression.property.name).toBe('variant')
  })
})
