import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure, ChunkDefinition } from '@teleporthq/teleport-types'
import { createPlugin } from '../src/index'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('plugin-react-inline-styles', () => {
  const plugin = createPlugin()
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
    type: CHUNK_TYPE.AST,
    fileId: FILE_TYPE.JS,
    linkAfter: ['import-local'],
    content: {},
  }

  it('adds nothing to the AST if not style is defined', async () => {
    const uidlSample = component('InlineStyles', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const oldStructure = JSON.stringify(structure)
    await plugin(structure)
    const newStructure = JSON.stringify(structure)

    expect(oldStructure).toBe(newStructure)
  })

  it('adds inline styles to the jsx element', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], null, style)
    element.content.key = 'container'
    const uidlSample = component('InlineStyles', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
    const nodeReference = componentChunk.meta.nodesLookup.container
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const styleAttr = nodeReference.openingElement.attributes[0]
    expect(styleAttr.name.name).toBe('style')
    expect(styleAttr.value.expression.properties[0].key.value).toBe('height')
  })
})
