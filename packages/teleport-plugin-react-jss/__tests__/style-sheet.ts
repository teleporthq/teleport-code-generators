import {
  ComponentStructure,
  UIDLStyleSetDefinition,
  UIDLDesignTokens,
} from '@teleporthq/teleport-types'
import { createStyleSheetPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createComponentChunk } from './mocks'

describe('Style Sheet from react-jss', () => {
  const componentChunk = createComponentChunk()

  it('Generates a style sheet from the give JSON of styleSet', async () => {
    const plugin = createStyleSheetPlugin()
    const uidl = component('MyComponent', elementNode('container'))
    const tokens: UIDLDesignTokens = {
      'blue-500': {
        type: 'static',
        content: '#9999ff',
      },
      'blue-600': {
        type: 'static',
        content: '#6b7db3',
      },
      'red-500': {
        type: 'static',
        content: '#ff9999',
      },
    }
    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      options: {},
      dependencies: {},
    }
    const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
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
      conditionalButton: {
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

    structure.uidl = {
      ...structure.uidl,
      styleSetDefinitions,
      designLanguage: {
        tokens,
      },
    }

    const result = await plugin(structure)
    const { chunks, dependencies } = result

    expect(chunks.length).toBe(3)
    expect(dependencies.createUseStyles.path).toBe('react-jss')
  })

  it('Changes the name of output file, with the name is passed', async () => {
    const plugin = createStyleSheetPlugin({ fileName: 'index' })
    const uidl = component('MyComponent', elementNode('container'))
    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      options: {},
      dependencies: {},
    }
    structure.uidl.styleSetDefinitions = {
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

    const result = await plugin(structure)
    const { chunks } = result
    const styleChunk = chunks.find((chunk) => chunk.name === 'index')
    expect(styleChunk).toBeDefined()
  })
})
