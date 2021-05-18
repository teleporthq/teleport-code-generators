import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createNextImagePlugin } from '../src'
import {
  ChunkDefinition,
  ChunkType,
  FileType,
  ComponentStructure,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

describe('plugin-jsx-next-image', () => {
  const plugin = createNextImagePlugin()

  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: 'img',
            },
            attributes: [],
          },
          closingElement: {
            name: {
              name: 'img',
            },
          },
        },
      },
    },
    type: ChunkType.AST,
    fileType: FileType.JS,
    linkAfter: ['import-local'],
    content: {},
  }

  const element = elementNode(
    'img',
    {
      src: staticNode('/playground_assets/image.png'),
      alt: staticNode('Demo Picture'),
    },
    [],
    null,
    {
      width: staticNode('100px'),
      height: staticNode('100px'),
    },
    {}
  )
  element.content.key = 'container'

  it(`When a local asset is having only width and height, 
    the jsx-next-image converts it to use Image Component`, async () => {
    const uidl = component('App', element)
    const structure: ComponentStructure = {
      uidl,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const result = await plugin(structure)
    const nodeChunk = (result.chunks[0].meta.nodesLookup as Record<string, types.JSXElement>)
      ?.container

    expect(nodeChunk).toBeDefined()
    expect((nodeChunk.openingElement.name as types.JSXIdentifier).name).toBe('Image')
    expect(Object.keys(result.dependencies).length).toBe(1)
    expect(Object.keys(result.dependencies).includes('Image')).toBe(true)
  })
})
