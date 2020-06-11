import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkDefinition,
  ComponentStructure,
  ChunkType,
  FileType,
  UIDLStyleSetDefinition,
} from '@teleporthq/teleport-types'

export const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
  '5ecfa1233b8e50f60ea2b64d': {
    id: '5ecfa1233b8e50f60ea2b64d',
    name: 'primaryButton',
    type: 'reusable-project-style-map',
    content: {
      background: staticNode('blue'),
      color: staticNode('red'),
    },
  },
  '5ecfa1233b8e50f60ea2b64b': {
    id: '5ecfa1233b8e50f60ea2b64b',
    name: 'secondaryButton',
    type: 'reusable-project-style-map',
    content: {
      background: staticNode('red'),
      color: staticNode('blue'),
    },
  },
}

export const setUpStructureWithHASTChunk = () => {
  const componentChunk: ChunkDefinition = {
    name: 'template',
    meta: {
      nodesLookup: {
        container: {
          type: 'element',
          tagName: 'div',
          properties: {},
        },
      },
    },
    fileType: FileType.HTML,
    type: ChunkType.HAST,
    linkAfter: [],
    content: {},
  }
  const style = {
    display: staticNode('display'),
  }
  const uidlSample = component('CSSPlugin', elementNode('container', null, [], null, style))

  const structure: ComponentStructure = {
    uidl: uidlSample,
    options: {},
    chunks: [componentChunk],
    dependencies: {},
  }
  return structure
}
