import { ComponentUIDL, GeneratedFile, ReactStyleVariation } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createAIChatMarkdownStylesPlugin } from '../src/ai-chat/markdown-styles-plugin'

/**
 * The chat bubble's markdown children (links, lists, bold) are created at
 * runtime by markdown-to-jsx, so they carry no styled-jsx scope class and the
 * per-node UIDL styles cannot reach them. This plugin appends descendant CSS
 * under `:global(...)` to the component's style template — these tests pin
 * that the CSS lands on the chat component and ONLY on the chat component.
 */

const chatComponent = (name: string): ComponentUIDL =>
  ({
    name,
    node: {
      type: 'element',
      content: {
        elementType: 'container',
        children: [
          {
            type: 'element',
            content: {
              elementType: 'container',
              name: 'ai-message-text',
              style: {
                fontSize: { type: 'static', content: '14px' },
              },
              children: [{ type: 'static', content: 'reply' }],
            },
          },
        ],
      },
    },
  } as unknown as ComponentUIDL)

const generate = async (uidl: ComponentUIDL): Promise<string> => {
  const generator = createReactComponentGenerator({
    variation: ReactStyleVariation.StyledJSX,
    plugins: [createAIChatMarkdownStylesPlugin()],
  })
  const { files } = await generator.generateComponent(uidl, { skipValidation: true })
  return files.find((file: GeneratedFile) => file.fileType === 'js')?.content ?? ''
}

describe('AI chat markdown styles plugin', () => {
  it('appends descendant rules for the runtime markdown children', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))

    expect(code).toContain(':global(a)')
    expect(code).toContain('text-decoration: underline')
    expect(code).toContain(':global(ul)')
    expect(code).toContain('list-style: disc')
    expect(code).toContain(':global(strong)')
    // Scoped under the message class, not emitted as bare global rules.
    expect(code).toMatch(/\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* :global\(a\)/)
  })

  it('leaves every other component untouched', async () => {
    const code = await generate(chatComponent('product-card'))

    expect(code).not.toContain(':global(a)')
    expect(code).not.toContain('list-style: disc')
  })
})
