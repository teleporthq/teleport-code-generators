import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'

describe('plugin-react-jss', () => {
  const plugin = createPlugin({ styleChunkName: 'jss-chunk', exportChunkName: 'export-chunk' })
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

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('JSS', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
  })

  it('Should add styled as dependency', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], { type: 'package' }, style)
    element.content.key = 'container'
    const uidlSample = component('JSS', element)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies, chunks } = await plugin(structure)
    const { injectSheet } = dependencies

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    expect(injectSheet.type).toBe('library')
    expect(injectSheet.path).toBe('react-jss')

    expect(chunks.length).toBe(3)
    expect(chunks[1].type).toBe('js')
    expect(chunks[1].name).toBe('jss-chunk')
    expect(chunks[2].type).toBe('js')
    expect(chunks[2].name).toBe('export-chunk')
  })
})
