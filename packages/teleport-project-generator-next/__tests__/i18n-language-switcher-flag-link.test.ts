import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createNextInternationalizationPlugin } from '../src/internationalization/locale-mapper-component'

/**
 * A language switcher can show a flag before each language's name. The flag carries the same
 * link as the name (the iterated locale code), so a click on it switches the language too: the
 * internationalization plugin has to make it the same Next.js locale switch, an `<img>` inside
 * `<Link href={router.asPath} locale={…}>`, and not a link to the relative path "fr".
 */

const localeLink = {
  type: 'url',
  content: { url: { type: 'expr', content: 'languageOption?.short' }, newTab: false },
}

const switcherWithFlags = {
  name: 'LanguageSwitcher',
  node: {
    type: 'element',
    content: {
      elementType: 'container',
      attrs: {
        'data-active-locale': {
          type: 'dynamic',
          content: { referenceType: 'global', id: 'locale', path: ['short'] },
        },
      },
      children: [
        {
          type: 'cms-list-repeater',
          content: {
            elementType: 'Repeater',
            name: 'languages',
            key: 'languages',
            renderPropIdentifier: 'languageOption',
            source: 'locales',
            nodes: {
              list: {
                type: 'element',
                content: {
                  elementType: 'container',
                  children: [
                    {
                      type: 'element',
                      content: {
                        elementType: 'image',
                        attrs: {
                          src: { type: 'expr', content: 'languageOption?.flag' },
                          alt: { type: 'expr', content: 'languageOption?.name' },
                        },
                        abilities: { link: localeLink },
                      },
                    },
                    {
                      type: 'element',
                      content: {
                        elementType: 'text',
                        semanticType: 'span',
                        abilities: { link: localeLink },
                        children: [{ type: 'static', content: 'es' }],
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  },
} as unknown as ComponentUIDL

describe('a language switcher flag', () => {
  it('is a Next.js locale switch, as the name beside it is', async () => {
    const generator = createReactComponentGenerator()
    generator.addPlugin(createNextInternationalizationPlugin())
    const { files } = await generator.generateComponent(switcherWithFlags, {
      skipValidation: true,
    })
    const code = (files as GeneratedFile[]).find((file) => file.fileType === 'js')?.content ?? ''

    expect(
      code.match(/<Link href=\{router\.asPath\} locale=\{languageOption\?\.short\}>/g)
    ).toHaveLength(2)
    expect(code).toMatch(
      /<Link href=\{router\.asPath\} locale=\{languageOption\?\.short\}>\s*<a>\s*<img[^>]*src=\{languageOption\?\.flag\}/
    )
    expect(code).not.toContain('href={languageOption?.short}')
  })
})
