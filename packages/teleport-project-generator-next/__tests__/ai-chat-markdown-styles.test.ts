import { ComponentUIDL, GeneratedFile, ReactStyleVariation } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createAIChatMarkdownStylesPlugin } from '../src/ai-chat/markdown-styles-plugin'

/**
 * The chat bubble's markdown children (links, lists, bold) are created at
 * runtime by markdown-to-jsx, so they carry no styled-jsx scope class and the
 * per-node UIDL styles cannot reach them. This plugin wraps each WHOLE selector
 * in `:global(...)` and appends it to the component's style template — these
 * tests pin that the CSS lands on the chat component, only on the chat
 * component, and in the one spelling that survives the styled-jsx compiler.
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

    expect(code).toContain('text-decoration: underline')
    expect(code).toContain('list-style: disc')
    // Scoped under the message class, not emitted as bare global rules.
    expect(code).toMatch(/:global\(\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* a\)/)
    expect(code).toMatch(/:global\(\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* ul\)/)
    expect(code).toMatch(/:global\(\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* strong\)/)
  })

  it('never leaves the scope class outside the :global wrapper', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))

    // `.cls :global(ul)` compiles to `.cls.jsx-HASH ul`, and the markdown root
    // never carries that hash — the rule would be dead on arrival.
    expect(code).not.toMatch(/\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* :global\(/)
    // `:global(.cls) ul` is dead for the mirror-image reason.
    expect(code).not.toMatch(/:global\(\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]*\) [a-z]/)
  })

  it("re-scopes the bubble's own rule so it reaches the markdown root", async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))

    // The UIDL's per-node rule compiled to `.cls.jsx-HASH`, so the bubble's
    // font-size silently never applied to the markdown it wraps.
    expect(code).toMatch(/:global\(\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]*\) \{/)
    expect(code).not.toMatch(/\n\s*\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]*\s*\{/)
  })

  it('compiles to selectors that can actually match the runtime children', async () => {
    // The whole point of the `:global(...)` spelling, proven against the real
    // styled-jsx compiler rather than assumed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const babel = require('@babel/core')
    const code = await generate(chatComponent('ai-assistant-chat'))
    const compiled = babel.transformSync(code, {
      filename: 'ai-assistant-chat.js',
      babelrc: false,
      configFile: false,
      plugins: [require.resolve('@babel/plugin-syntax-jsx'), require.resolve('styled-jsx/babel')],
    }).code as string

    const css = compiled.slice(compiled.indexOf('_JSXStyle'))
    expect(css).toMatch(/\.[A-Za-z0-9_-]*ai-message-text[A-Za-z0-9_-]* ul\{/)
    // Not one rule about this bubble may keep a build-time hash.
    expect(css).not.toMatch(/ai-message-text[A-Za-z0-9_-]*\.jsx-/)
  })

  it('leaves every other component untouched', async () => {
    const code = await generate(chatComponent('product-card'))

    expect(code).not.toContain(':global(')
    expect(code).not.toContain('list-style: disc')
  })
})
