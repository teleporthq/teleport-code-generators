import { staticNode } from '@teleporthq/teleport-uidl-builders'
import { createStyleSheetPlugin } from '../src/style-sheet'
import { setUpStructureWithHASTChunk } from './mocks'

describe('plugin-css-modules-style-sheet', () => {
  it('should generate css modules when the styleSetDefinitions are presnet', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setUpStructureWithHASTChunk()
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

    const { chunks } = await plugin(structure)
    const cssFile = chunks.find((chunk) => chunk.fileType === 'css')

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('.primaryButton')
    expect(cssFile.content).toContain('secondaryButton')
    expect(cssFile.content).toContain('.conditionalButton:hover')
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(cssFile.content).not.toContain('5ecfa1233b8e50f60ea2b64b')
  })

  it('should not generate file when the styleSetDefinition is empty', async () => {
    const plugin = createStyleSheetPlugin()
    const structure = setUpStructureWithHASTChunk()

    const result = await plugin(structure)

    expect(result).toBe(undefined)
  })
})
