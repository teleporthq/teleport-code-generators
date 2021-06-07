import { ComponentStructure } from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createComponentChunk } from './mocks'

describe('Referenced Styles on Node', () => {
  const componentChunk = createComponentChunk()
  const uidl = component('MyComponent', elementNode('container', null, [], null, null, null, null))

  it('Media and pseudo styles are generated from referencedStyles', async () => {
    const plugin = createReactStyledJSXPlugin()
    uidl.node.content.referencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
      '5ed659b1732f9b804f7b6382': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'element-state', content: 'hover' }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
    }
    uidl.node.content.key = 'container'

    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {},
    }

    const result = await plugin(structure)
    const { chunks } = result
    const jsxComponent = chunks.find((chunk) => chunk.name === 'jsx-component')
    const styleSheet =
      jsxComponent.content.declarations[0].init.body.body[0].argument.children[1].children[0]
        .expression.quasis[0].value
    expect(styleSheet.raw).toContain(`@media(max-width: 991px)`)
  })
})
