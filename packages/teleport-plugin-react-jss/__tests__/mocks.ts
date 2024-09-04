import { ChunkDefinition, FileType, ChunkType } from '@teleporthq/teleport-types'
import * as types from '@babel/types'

export const createComponentChunk = (): ChunkDefinition => {
  const jsxElement: types.JSXElement = {
    type: 'JSXElement',
    openingElement: {
      type: 'JSXOpeningElement',
      name: {
        type: 'JSXIdentifier',
        name: '',
      },
      selfClosing: false,
      attributes: [],
    },
    children: [],
  }

  return {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: jsxElement as unknown as Record<string, unknown>,
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
  }
}
