import {
  ChunkDefinition,
  ComponentStructure,
  UIDLStyleDefinitions,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'

export const createComponentChunk = (elementKey: string = 'container') => {
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        [elementKey]: {
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

  return componentChunk
}

export const setupPluginStructure = (
  elementKey: string = 'container',
  styleDefinition?: UIDLStyleDefinitions
) => {
  const style = styleDefinition || {
    height: staticNode('100px'),
  }
  const element = elementNode('container', {}, [], undefined, style)
  element.content.key = elementKey
  const uidlSample = component('CSSModules', element)

  const structure: ComponentStructure = {
    uidl: uidlSample,
    options: {},
    chunks: [createComponentChunk(elementKey)],
    dependencies: {},
  }

  return structure
}
