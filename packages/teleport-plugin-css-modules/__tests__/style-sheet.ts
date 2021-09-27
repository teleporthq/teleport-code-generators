import { UIDLStyleSetDefinition, UIDLStyleSetTokenReference } from '@teleporthq/teleport-types'
import { UIDLDesignTokens } from '@teleporthq/teleport-types/src'
import { dynamicNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createStyleSheetPlugin } from '../src/style-sheet'
import { generateStylesFromStyleSetDefinitions } from '../src/utils'
import { setupPluginStructure } from './mocks'

describe('plugin-css-modules-style-sheet', () => {
  const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
    'primary-button': {
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
            background: staticNode('purple'),
            color: dynamicNode('token', 'red-500') as UIDLStyleSetTokenReference,
          },
        },
        {
          type: 'element-state',
          meta: { state: 'hover' },
          content: {
            background: dynamicNode('token', 'blue-500') as UIDLStyleSetTokenReference,
          },
        },
      ],
      content: {
        background: staticNode('red'),
        color: staticNode('blue'),
      },
    },
  }
  it('should generate css modules when the styleSetDefinitions are presnet', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setupPluginStructure()
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
    structure.uidl = {
      ...structure.uidl,
      styleSetDefinitions,
      designLanguage: {
        tokens,
      },
    }

    const { chunks } = await plugin(structure)
    const cssFile = chunks.find((chunk) => chunk.fileType === 'css')
    const { content } = cssFile

    expect(cssFile).toBeDefined()
    expect(content).toContain(`:root {
  --red-500: #ff9999;
  --blue-500: #9999ff;
  --blue-600: #6b7db3;
}
`)
    expect(content).toContain(`.conditionalButton:hover {
  background: var(--blue-500);
}
`)
    expect(content).toContain(`color: var(--red-500)`)
    expect(content).toContain('.primary-button')
    expect(content).toContain('.secondaryButton')
    expect(content).toContain('.conditionalButton:hover')
    expect(content).toContain('@media(max-width: 991px)')
  })

  it('should not generate file when the styleSetDefinition is empty', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setupPluginStructure()

    const result = await plugin(structure)

    expect(result).toBe(undefined)
  })

  it('Generates styles from UIDLStyleSetDefinitions', () => {
    const cssMap: string[] = []
    const mediaStylesMap: Record<string, Record<string, unknown>> = {}
    generateStylesFromStyleSetDefinitions({ styleSetDefinitions, cssMap, mediaStylesMap })

    expect(cssMap.length).toBe(4)
    expect(Object.keys(mediaStylesMap).length).toBe(1)
  })
})
