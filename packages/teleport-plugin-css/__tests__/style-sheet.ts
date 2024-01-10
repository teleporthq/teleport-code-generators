import {
  UIDLDesignTokens,
  UIDLStyleSetDefinition,
  UIDLStyleSetTokenReference,
} from '@teleporthq/teleport-types'
import { staticNode, dynamicNode } from '@teleporthq/teleport-uidl-builders'
import { createStyleSheetPlugin } from '../src/style-sheet'
import { setUpHASTChunk, setUpStructureWithHASTChunk } from './mocks'

describe('plugin-css-style-sheet', () => {
  it('should generate css when the styleSetDefinitions are presnet', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setUpStructureWithHASTChunk()
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
      someClassId: {
        type: 'reusable-project-style-map',
        content: {
          background: staticNode('red'),
          color: staticNode('blue'),
        },
        className: 'secondaryButton',
        subselectors: ' h1',
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
    expect(content).toContain('.primaryButton')
    expect(content).toContain('secondaryButton')
    expect(content).toContain('.conditionalButton:hover')
    expect(content).toContain('.secondaryButton h1')
    expect(content).toContain('@media(max-width: 991px)')
    expect(content).not.toContain('5ecfa1233b8e50f60ea2b64b')
  })

  it('should not generate file when the styleSetDefinition is empty', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setUpStructureWithHASTChunk()

    const result = await plugin(structure)
    expect(result.chunks.length).toBe(1)
    expect(result.chunks[0]).toEqual(setUpHASTChunk())
  })
})
