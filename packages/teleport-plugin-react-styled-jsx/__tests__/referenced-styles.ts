import {
  ChunkDefinition,
  ChunkType,
  FileType,
  ComponentStructure,
} from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'

describe('Referenced Styles on Node', () => {
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: 'div',
            },
            attributes: [],
          },
          children: [],
        },
        group: {
          openingElement: {
            name: {
              name: 'Fragment',
            },
            attributes: [],
          },
          children: [],
        },
      },
      dynamicRefPrefix: {
        prop: 'props.',
      },
    },
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: ['import-local'],
    content: {
      declarations: [
        {
          init: {
            body: {
              body: [
                {
                  argument: {
                    children: [],
                  },
                },
              ],
            },
          },
        },
      ],
    },
  }
  const uidl = component('MyComponent', elementNode('container', null, [], null, null, null, null))

  it('Media and pseudo styles are generated from referencedStyles', async () => {
    const plugin = createReactStyledJSXPlugin()
    uidl.node.content.referencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        id: '5ed659b1732f9b804f7b6381',
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
        id: '5ed659b1732f9b804f7b6382',
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

    expect(chunks[0].type).toBe('ast')
  })
})
