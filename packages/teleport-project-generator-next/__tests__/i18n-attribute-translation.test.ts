import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createNextInternationalizationPlugin } from '../src/internationalization/locale-mapper-component'

/**
 * A translated ATTRIBUTE travels differently from translated text: `node-to-jsx`
 * emits it as a plain string holding the main-language copy and records it, and
 * this plugin swaps the value for the runtime lookup. These tests pin both ends —
 * the emitted markup stays valid without the plugin, and becomes per-locale with it.
 */

const TRANSLATION_KEY = 'input_placeholder_a1b2c3'
const MAIN_LANGUAGE_TEXT = 'Full name'

const localeAttrComponent = (attrs: Record<string, unknown>): ComponentUIDL =>
  ({
    name: 'SignUpForm',
    node: {
      type: 'element',
      content: {
        elementType: 'container',
        children: [
          {
            type: 'element',
            content: {
              elementType: 'input',
              attrs,
            },
          },
        ],
      },
    },
  } as unknown as ComponentUIDL)

const localePlaceholder = (key = TRANSLATION_KEY, fallback = MAIN_LANGUAGE_TEXT) => ({
  placeholder: {
    type: 'dynamic',
    content: { referenceType: 'locale', id: key, fallback },
  },
})

const jsFileOf = (files: GeneratedFile[]): string =>
  files.find((file) => file.fileType === 'js')?.content ?? ''

const compile = async (uidl: ComponentUIDL, withNextI18n: boolean) => {
  const generator = createReactComponentGenerator()
  if (withNextI18n) {
    generator.addPlugin(createNextInternationalizationPlugin())
  }
  return generator.generateComponent(uidl, { skipValidation: true })
}

const generate = async (uidl: ComponentUIDL, withNextI18n: boolean): Promise<string> => {
  const { files } = await compile(uidl, withNextI18n)
  return jsFileOf(files)
}

describe('translated attributes without a framework i18n plugin', () => {
  it('keeps the main-language text so the markup stays valid and readable', async () => {
    const code = await generate(localeAttrComponent(localePlaceholder()), false)

    expect(code).toContain(`placeholder="${MAIN_LANGUAGE_TEXT}"`)
    expect(code).not.toContain('translate')
    // The bare identifier the `default:` branch used to emit before locale was handled.
    expect(code).not.toContain(`placeholder={${TRANSLATION_KEY}}`)
  })

  it('emits an empty string rather than `undefined` when no main-language copy came through', async () => {
    const attrs = {
      placeholder: { type: 'dynamic', content: { referenceType: 'locale', id: TRANSLATION_KEY } },
    }
    const code = await generate(localeAttrComponent(attrs), false)

    expect(code).toContain('placeholder=""')
    expect(code).not.toContain('undefined')
  })

  it('drops the attribute when the reference carries no translation key', async () => {
    const attrs = {
      placeholder: { type: 'dynamic', content: { referenceType: 'locale', id: '' } },
    }
    const code = await generate(localeAttrComponent(attrs), false)

    expect(code).not.toContain('placeholder')
  })
})

describe('translated attributes on Next.js', () => {
  it('rewrites the value to a next-intl lookup and declares the hook once', async () => {
    const code = await generate(localeAttrComponent(localePlaceholder()), true)

    expect(code).toContain(`placeholder={translate.raw('${TRANSLATION_KEY}')}`)
    expect(code).toContain('const translate = useTranslations()')
    expect(code.match(/const translate = useTranslations\(\)/g)).toHaveLength(1)
    // The main-language copy only ever existed as the no-plugin fallback.
    expect(code).not.toContain(`placeholder="${MAIN_LANGUAGE_TEXT}"`)
  })

  it('registers next-intl so the import statements plugin emits the hook import', async () => {
    const { dependencies } = await compile(localeAttrComponent(localePlaceholder()), true)

    expect(dependencies['next-intl']).toBeDefined()
  })

  it('translates every locale-bound attribute on the same element', async () => {
    const attrs = {
      ...localePlaceholder(),
      'aria-label': {
        type: 'dynamic',
        content: { referenceType: 'locale', id: 'aria_x9', fallback: 'Your full name' },
      },
      title: {
        type: 'dynamic',
        content: { referenceType: 'locale', id: 'title_y7', fallback: 'Enter your name' },
      },
      type: { type: 'static', content: 'text' },
    }
    const code = await generate(localeAttrComponent(attrs), true)

    expect(code).toContain(`placeholder={translate.raw('${TRANSLATION_KEY}')}`)
    expect(code).toContain("aria-label={translate.raw('aria_x9')}")
    expect(code).toContain("title={translate.raw('title_y7')}")
    // Untranslated attributes are untouched.
    expect(code).toContain('type="text"')
    expect(code.match(/const translate = useTranslations\(\)/g)).toHaveLength(1)
  })

  it('reuses the hook already declared for translated children', async () => {
    const uidl = {
      name: 'SignUpForm',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'input',
                attrs: localePlaceholder(),
              },
            },
            {
              type: 'element',
              content: {
                elementType: 'span',
                children: [
                  { type: 'dynamic', content: { referenceType: 'locale', id: 'heading_k2' } },
                ],
              },
            },
          ],
        },
      },
    } as unknown as ComponentUIDL

    const code = await generate(uidl, true)

    expect(code).toContain(`placeholder={translate.raw('${TRANSLATION_KEY}')}`)
    expect(code).toContain("translate.raw('heading_k2')")
    expect(code.match(/const translate = useTranslations\(\)/g)).toHaveLength(1)
  })
})

describe('translated children of a text-only element', () => {
  /**
   * A `<select>`'s option labels — the storefront's sort order and its review
   * rating filter. `<option>` may not contain an element, so the usual
   * `dangerouslySetInnerHTML` span would be serialized by React and then thrown
   * away by the browser's parser: a hydration mismatch on every localized page
   * with a dropdown. The studio stores an option's copy as a `static` entry
   * (bare text in the messages file) so this inline lookup is what it needs.
   */
  const selectWithOption = (): ComponentUIDL =>
    ({
      name: 'ProductsToolbar',
      node: {
        type: 'element',
        content: {
          elementType: 'select',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'option',
                attrs: { value: { type: 'static', content: 'name_asc' } },
                children: [
                  {
                    type: 'dynamic',
                    content: { referenceType: 'locale', id: 'Option_name_asc_k1' },
                  },
                ],
              },
            },
          ],
        },
      },
    } as unknown as ComponentUIDL)

  it('reads the option label as plain text instead of injecting markup', async () => {
    const code = await generate(selectWithOption(), true)

    expect(code).toContain("{translate.raw('Option_name_asc_k1')}")
    expect(code).not.toContain('dangerouslySetInnerHTML')
    expect(code).toContain('const translate = useTranslations()')
  })

  it('still injects markup for a translated child anywhere else', async () => {
    const uidl = {
      name: 'Heading',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'h2',
                children: [
                  { type: 'dynamic', content: { referenceType: 'locale', id: 'Heading_k2' } },
                ],
              },
            },
          ],
        },
      },
    } as unknown as ComponentUIDL

    const code = await generate(uidl, true)

    expect(code).toContain('dangerouslySetInnerHTML')
    expect(code).toContain("translate.raw('Heading_k2')")
  })
})

describe('the next-intl import', () => {
  it('is not registered on a component that holds no translated copy', async () => {
    const uidl = {
      name: 'NotFound',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'h3',
                children: [{ type: 'static', content: 'Page not found' }],
              },
            },
          ],
        },
      },
    } as unknown as ComponentUIDL

    const { dependencies } = await compile(uidl, true)
    const code = await generate(uidl, true)

    expect(dependencies['next-intl']).toBeUndefined()
    expect(code).not.toContain('useTranslations')
  })
})

describe('keys minted from user text are sanitized for next-intl', () => {
  // Generated stores persisted keys like `2. Definitions_UUSf6E` (the node's
  // own text plus a suffix). next-intl reads `.` as a namespace separator and
  // rejects the WHOLE messages file over one such key, so every lookup — and
  // the messages writer in `teleport-project-plugin-i18n-files` — funnels keys
  // through `StringUtils.sanitizeTranslationKey`.
  const DOTTED_KEY = '2. Definitions_UUSf6E'
  const SAFE_KEY = '2_ Definitions_UUSf6E'

  it('replaces dots in attribute lookups', async () => {
    const code = await generate(localeAttrComponent(localePlaceholder(DOTTED_KEY)), true)

    expect(code).toContain(`placeholder={translate.raw('${SAFE_KEY}')}`)
    expect(code).not.toContain(`'${DOTTED_KEY}'`)
  })

  it('replaces dots in translated-children lookups', async () => {
    const uidl = {
      name: 'TermsPage',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'span',
                children: [
                  { type: 'dynamic', content: { referenceType: 'locale', id: DOTTED_KEY } },
                ],
              },
            },
          ],
        },
      },
    } as unknown as ComponentUIDL

    const code = await generate(uidl, true)

    expect(code).toContain(`translate.raw('${SAFE_KEY}')`)
    expect(code).not.toContain(`translate.raw('${DOTTED_KEY}')`)
  })
})
