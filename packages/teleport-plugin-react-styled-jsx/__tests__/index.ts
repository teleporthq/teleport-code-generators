import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkDefinition,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src/index'

describe('plugin-react-styled-jsx', () => {
  const plugin = createReactStyledJSXPlugin()
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
    content: {},
  }

  it('adds nothing on the AST if not styles are defined', async () => {
    const uidlSample = component('StyledJSX', elementNode('container'))
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
})
