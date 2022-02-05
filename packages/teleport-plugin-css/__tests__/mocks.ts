import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkDefinition,
  ComponentStructure,
  ChunkType,
  FileType,
  UIDLStyleSetDefinition,
} from '@teleporthq/teleport-types'

export const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
  primaryButton: {
    type: 'reusable-project-style-map',
    content: {
      background: staticNode('blue'),
      color: staticNode('red'),
    },
  },
  secondaryButton: {
    type: 'reusable-project-style-map',
    content: {
      background: staticNode('red'),
      color: staticNode('blue'),
    },
  },
}

export const setUpJSXComponentChunk = (): ChunkDefinition => ({
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
      prop: 'props.',
    },
  },
  type: ChunkType.AST,
  fileType: FileType.TSX,
  linkAfter: ['import-local'],
  content: {},
})

export const setUpHASTChunk = (): ChunkDefinition => ({
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
})

export const setUpStructureWithHASTChunk = () => {
  const style = {
    display: staticNode('display'),
  }
  const uidlSample = component('CSSPlugin', elementNode('container', null, [], null, style))

  const structure: ComponentStructure = {
    uidl: uidlSample,
    options: {},
    chunks: [setUpHASTChunk()],
    dependencies: {},
  }
  return structure
}
