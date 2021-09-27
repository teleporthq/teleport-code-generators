import { staticNode, elementNode } from '@teleporthq/teleport-uidl-builders'
import { ChunkDefinition, ChunkType, FileType } from '@teleporthq/teleport-types'

export const createElementWithStyle = () => {
  const style = {
    height: staticNode('100px'),
  }
  const element = elementNode('container', {}, [], null, style)
  const elementWithKey = {
    ...element,
    content: {
      ...element.content,
      key: 'container',
    },
  }

  return elementWithKey
}

export const createComponentChunk = () => {
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            attributes: [],
            name: {
              name: '',
            },
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
    content: {},
  }
  return componentChunk
}
