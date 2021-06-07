import { ChunkDefinition, ChunkType, FileType } from '@teleporthq/teleport-types'

export const createComponentChunk = (): ChunkDefinition => {
  return {
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
        prop: 'props',
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
}
