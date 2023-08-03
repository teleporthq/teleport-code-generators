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
  const element = elementNode(
    'img',
    {
      src: staticNode('/playground_assets/image.png'),
      alt: staticNode('Demo Picture'),
    },
    [],
    undefined,
    {
      width: staticNode('100px'),
      height: staticNode('100px'),
    },
    {}
  )
  element.content.key = 'container'

  it(`When a local asset is having only width and height,
    the jsx-next-image converts it to use Image Component`, async () => {
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
    const structureMock: ComponentStructure = {
      uidl: component('App', element),
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks, dependencies } = await plugin(structureMock)
    const nodeChunk = (chunks[0].meta.nodesLookup as Record<string, types.JSXElement>)?.container

    expect(nodeChunk).toBeDefined()
    expect((nodeChunk.openingElement.name as types.JSXIdentifier).name).toBe('Image')
    expect(Object.keys(dependencies).length).toBe(1)
    expect(Object.keys(dependencies).includes('Image')).toBe(true)
  })

  it('Does not convert images with remote souce to use Next Image component', async () => {
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
    element.content.attrs.src.content = `https://via.placeholder.com/150`
    const uidl = component('App', element)
    const structure = {
      uidl,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks, dependencies } = await plugin(structure)
    const nodeChunk = (chunks[0].meta.nodesLookup as Record<string, types.JSXElement>)?.container

    expect(nodeChunk).toBeDefined()
    expect((nodeChunk.openingElement.name as types.JSXIdentifier).name).toBe('img')
    expect(Object.keys(dependencies).length).toBe(0)
    expect(Object.keys(dependencies).includes('Image')).toBe(false)
  })

  it('Does not convert images with different css unit identifiers', async () => {
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
    element.content.attrs.src.content = '/playground_assets/image.png'
    element.content.style.width.content = '100%'
    const uidl = component('App', element)
    const structure = {
      uidl,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks, dependencies } = await plugin(structure)
    const nodeChunk = (chunks[0].meta.nodesLookup as Record<string, types.JSXElement>)?.container

    expect(nodeChunk).toBeDefined()
    expect((nodeChunk.openingElement.name as types.JSXIdentifier).name).toBe('img')
    expect(Object.keys(dependencies).length).toBe(0)
    expect(Object.keys(dependencies).includes('Image')).toBe(false)
  })

  it('Does not convert images with un-matched css units', async () => {
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
    element.content.attrs.src.content = '/playground_assets/image.png'
    element.content.style.width.content = 'auto'
    const uidl = component('App', element)
    const structure = {
      uidl,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks, dependencies } = await plugin(structure)
    const nodeChunk = (chunks[0].meta.nodesLookup as Record<string, types.JSXElement>)?.container

    expect(nodeChunk).toBeDefined()
    expect((nodeChunk.openingElement.name as types.JSXIdentifier).name).toBe('img')
    expect(Object.keys(dependencies).length).toBe(0)
    expect(Object.keys(dependencies).includes('Image')).toBe(false)
  })
})
