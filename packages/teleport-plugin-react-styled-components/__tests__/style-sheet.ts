import {
  ChunkDefinition,
  ChunkType,
  FileType,
  ComponentStructure,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'

describe('Style Sheet from styled components', () => {
  const componentChunk: ChunkDefinition = {
    name: 'jsx-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: '',
            },
          },
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

  it('Generates a style sheet from the give JSON of styleSet', async () => {
    const plugin = createStyleSheetPlugin()
    const uidl = component('MyComponent', elementNode('container'))
    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      options: {},
      dependencies: {},
    }
    structure.uidl.styleSetDefinitions = {
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
      '5ecfa1233b8e50f60ea2b64c': {
        id: '5ecfa1233b8e50f60ea2b64c',
        name: 'conditionalButton',
        type: 'reusable-project-style-map',
        conditions: [
          {
            type: 'screen-size',
            meta: { maxWidth: 991 },
            content: {
              backgrouns: staticNode('purple'),
            },
          },
          {
            type: 'element-state',
            meta: { state: 'hover' },
            content: {
              background: staticNode('yellow'),
            },
          },
        ],
        content: {
          background: staticNode('red'),
          color: staticNode('blue'),
        },
      },
    }

    const result = await plugin(structure)
    const { chunks, dependencies } = result
    const styleChunks = chunks.filter((chunk) => chunk.name === 'style')

    expect(styleChunks.length).toBe(3)
    expect(dependencies.css.path).toBe('styled-components')
  })

  it('Changes the name of output file, with the name that is passed', async () => {
    const plugin = createStyleSheetPlugin({ fileName: 'index' })
    const uidl = component('MyComponent', elementNode('container'))
    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      options: {},
      dependencies: {},
    }
    structure.uidl.styleSetDefinitions = {
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

    const result = await plugin(structure)
    const { chunks, dependencies } = result
    const styleChunks = chunks.filter((chunk) => chunk.name === 'style')

    expect(styleChunks.length).toBe(0)
    expect(dependencies.css.path).toBe('styled-components')
    expect(result.uidl.outputOptions.fileName).toBe('index')
  })
})
