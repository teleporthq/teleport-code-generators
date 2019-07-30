import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('plugin-vue-style', () => {
  const plugin = createPlugin({ vueTemplateChunk: 'vue-chunk' })
  const componentChunk: ChunkDefinition = {
    name: 'vue-chunk',
    meta: {
      nodesLookup: {
        container: {
          type: 'element',
          tagName: 'div',
          properties: {},
        },
      },
    },
    fileId: FILE_TYPE.HTML,
    type: CHUNK_TYPE.HAST,
    linkAfter: [],
    content: {},
  }

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('VueStyles', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
  })

  it('generates a string chunk out of the styles and adds the className', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], null, style)
    element.content.key = 'container'
    const uidlSample = component('VueStyle', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = componentChunk.meta.nodesLookup.container
    expect(nodeReference.properties.class).toBe('container')
  })
})
