import { ComponentUIDL, GeneratedFile, ReactStyleVariation } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createAIChatOptionChipsStylesPlugin } from '../src/ai-chat/option-chips-styles-plugin'

/**
 * The assistant's answer chips change appearance with a `data-option-state`
 * attribute its workflows write — an attribute selector, which a per-node UIDL
 * style cannot express. This plugin appends those rules to the chat's own
 * style template.
 *
 * Unlike the markdown rules these must NOT be `:global(...)`: a chip is a
 * lowercase `<button>` in the component's own JSX, so it does carry the scope
 * class, and going global would leak the selectors into every page.
 */

const chatComponent = (name: string, withChips = true): ComponentUIDL =>
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
              style: { fontSize: { type: 'static', content: '14px' } },
              children: [{ type: 'static', content: 'reply' }],
            },
          },
          ...(withChips
            ? [
                {
                  type: 'element',
                  content: {
                    elementType: 'container',
                    name: 'option-chip-1',
                    style: { padding: { type: 'static', content: '6px 12px' } },
                    children: [{ type: 'static', content: 'Yes' }],
                  },
                },
                {
                  type: 'element',
                  content: {
                    elementType: 'container',
                    name: 'option-chip-2',
                    style: { padding: { type: 'static', content: '6px 12px' } },
                    children: [{ type: 'static', content: 'No' }],
                  },
                },
              ]
            : []),
        ],
      },
    },
  } as unknown as ComponentUIDL)

const generate = async (uidl: ComponentUIDL): Promise<string> => {
  const generator = createReactComponentGenerator({
    variation: ReactStyleVariation.StyledJSX,
    plugins: [createAIChatOptionChipsStylesPlugin()],
  })
  const { files } = await generator.generateComponent(uidl, { skipValidation: true })
  return files.find((file: GeneratedFile) => file.fileType === 'js')?.content ?? ''
}

describe('AI chat option-chip styles plugin', () => {
  it('styles the chip the visitor picked so the choice stays visible', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))
    expect(code).toContain("[data-option-state='selected']")
    expect(code).toContain('--color-primary')
  })

  it('dims the options that were not taken, or that a later message retired', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))
    expect(code).toContain("[data-option-state='inactive']")
    expect(code).toContain('opacity: 0.5')
  })

  it('only lets a live chip react to the pointer', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))
    expect(code).toContain(':not(:disabled):hover')
    expect(code).toContain(':disabled')
  })

  it('emits a rule for every chip slot', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))
    // The generator normalises `option-chip-1` to `option-chip1` in the class.
    const selectedRules = code.match(/option-chip-?\d[^,{]*\[data-option-state='selected'\]/g) ?? []
    expect(selectedRules.length).toBe(2)
  })

  it('keeps the rules scoped, because a chip DOES carry the styled-jsx class', async () => {
    const code = await generate(chatComponent('ai-assistant-chat'))
    // Going global here would leak the selectors into every page rendering the
    // chat; the markdown plugin needs `:global` only because its targets are
    // created at runtime by a capitalized component.
    expect(code).not.toContain(':global(.option-chip')
  })

  it('leaves other components alone', async () => {
    const code = await generate(chatComponent('product-card'))
    expect(code).not.toContain('data-option-state')
  })

  it('is a no-op on a chat activated before chips existed', async () => {
    const code = await generate(chatComponent('ai-assistant-chat', false))
    expect(code).not.toContain('data-option-state')
  })
})
