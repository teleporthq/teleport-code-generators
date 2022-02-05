import { ChunkDefinition, FileType, ChunkType } from '@teleporthq/teleport-types'

export const createComponentChunk = (): ChunkDefinition => ({
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
          params: [],
          body: {
            body: [],
          },
        },
      },
    ],
  },
})
