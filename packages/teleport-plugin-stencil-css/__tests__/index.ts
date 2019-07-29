import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'

describe('plugin-stencil-css', () => {
  const plugin = createPlugin({
    componentChunkName: 'jsx-component',
    componentDecoratorChunkName: 'decorator',
  })
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: '',
            },
            attributes: [],
          },
        },
      },
      dynamicRefPrefix: {
        prop: 'props.',
      },
    },
    type: 'js',
    linkAfter: ['import-local'],
    content: {},
  }

  const decoratorChunk: ChunkDefinition = {
    name: 'decorator',
    type: 'js',
    linkAfter: ['import-local'],
    content: {
      expression: {
        arguments: [
          {
            properties: [],
          },
        ],
      },
    },
  }

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('test', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk, decoratorChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
  })

  it('generates a string chunk out of the styles and adds the className', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], null, style)
    element.content.key = 'container'
    const uidlSample = component('test', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk, decoratorChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(3)
    expect(chunks[2].type).toBe('string')
    expect(chunks[2].content).toContain('height: 100px;')
  })
})
