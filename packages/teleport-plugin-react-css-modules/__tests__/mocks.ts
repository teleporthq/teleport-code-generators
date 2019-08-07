import {
  ChunkDefinition,
  ComponentStructure,
  UIDLStyleDefinitions,
} from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'

export const createComponentChunk = (elementKey: string = 'container') => {
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        [elementKey]: {
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
    fileType: FILE_TYPE.JS,
    linkAfter: ['import-local'],
    content: {},
  }

  return componentChunk
}

export const setupPluginStructure = (
  elementKey: string = 'container',
  styleDefinition: UIDLStyleDefinitions = null
) => {
  const style = styleDefinition || {
    height: staticNode('100px'),
  }
  const element = elementNode('container', {}, [], null, style)
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
