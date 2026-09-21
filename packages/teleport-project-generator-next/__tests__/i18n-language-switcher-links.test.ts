import { ComponentUIDL, GeneratedFile } from '@teleporthq/teleport-types'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createNextInternationalizationPlugin } from '../src/internationalization/locale-mapper-component'

/**
 * A language switcher's link resolves to the iterated locale code
 * (`href={<language>?.short}`), which the internationalization plugin rewrites
 * into the Next.js locale switch `<Link href={router.asPath} locale={…}>`. A
 * bare `<a href="es">` would resolve RELATIVE to the current page — "/es/es"
 * from the Spanish home — and land on a 404. The inline switcher renders its
 * links from an array mapper's render prop, so the rewrite has to reach into
 * JSX attributes, not only children.
 */

/** The link ability the editor puts on a switcher option: a URL that is the iterated locale code. */
const localeLink = (url: Record<string, unknown>) => ({
  type: 'url',
  content: { url, newTab: false },
})

const switcherComponent = (link: Record<string, unknown>): ComponentUIDL =>
  ({
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
                          elementType: 'text',
                          semanticType: 'span',
                          abilities: { link },
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
  } as unknown as ComponentUIDL)

const jsFileOf = (files: GeneratedFile[]): string =>
  files.find((file) => file.fileType === 'js')?.content ?? ''

const generate = async (uidl: ComponentUIDL): Promise<string> => {
  const generator = createReactComponentGenerator()
  generator.addPlugin(createNextInternationalizationPlugin())
  const { files } = await generator.generateComponent(uidl, { skipValidation: true })
  return jsFileOf(files)
}

describe('language switcher links inside an array mapper render prop', () => {
  it('become Next.js locale switches that keep the visitor on the current page', async () => {
    const code = await generate(
      switcherComponent(localeLink({ type: 'expr', content: 'languageOption?.short' }))
    )

    expect(code).toContain('<Link href={router.asPath} locale={languageOption?.short}>')
    expect(code).not.toContain('href={languageOption?.short}')
    expect(code).toContain('const router = useRouter()')
  })

  it('leave any other link alone — only the bare locale code is a locale switch', async () => {
    const code = await generate(
      switcherComponent(localeLink({ type: 'expr', content: "'/' + languageOption?.short" }))
    )

    expect(code).toContain("<a href={'/' + languageOption?.short}>")
    expect(code).not.toContain('router.asPath')
  })
})
