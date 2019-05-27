import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'
import {
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { createPlugin } from '../src/index'

describe('plugin-vue-style', () => {
  const plugin = createPlugin({ vueTemplateChunk: 'vue-chunk' })
  const componentChunk: ChunkDefinition = {
    name: 'vue-chunk',
    meta: {
      lookup: {
        container: {
          type: 'element',
          tagName: 'div',
          properties: {},
        },
      },
    },
    type: 'html',
    linkAfter: [],
    content: {},
  }

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('VueStyles', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
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
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = componentChunk.meta.lookup.container
    expect(nodeReference.properties.class).toBe('container')
  })
})
