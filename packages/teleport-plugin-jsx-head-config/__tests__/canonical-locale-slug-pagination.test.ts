import * as types from '@babel/types'
import generator from '@babel/generator'
import { createJSXHeadConfigPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
  ComponentUIDL,
} from '@teleporthq/teleport-types'

/**
 * Two things a canonical asset can say beyond its path:
 *  - `localizedParams`: a route parameter whose value differs per locale (a
 *    post's translated slug). Each hreflang link then reads the locale's own
 *    value from the row and falls back to the route's parameter — instead of
 *    pointing every locale at the current locale's slug.
 *  - `pageParam`: a listing paged by `?page=N` is its own page from the
 *    second one on: the canonical and og:url carry the parameter.
 */

const makeJsxChunk = (): ChunkDefinition => ({
  type: ChunkType.AST,
  fileType: FileType.JS,
  name: 'jsx-component',
  content: {},
  linkAfter: [],
  meta: {
    nodesLookup: {
      container: {
        type: 'JSXElement',
        openingElement: {
          type: 'JSXOpeningElement',
          name: { type: 'JSXIdentifier', name: 'div' },
          attributes: [],
          selfClosing: false,
        },
        closingElement: { type: 'JSXClosingElement', name: { type: 'JSXIdentifier', name: 'div' } },
        children: [],
      },
    },
  },
})

const runPlugin = async (
  seo: ComponentUIDL['seo'],
  options: ComponentStructure['options'] = {}
): Promise<string> => {
  const plugin = createJSXHeadConfigPlugin()
  const uidlSample = component('SimpleComponent', elementNode('container'))
  uidlSample.node.content.key = 'container'
  uidlSample.seo = seo
  const structure: ComponentStructure = {
    uidl: uidlSample,
    options,
    chunks: [makeJsxChunk()],
    dependencies: {},
  }
  await plugin(structure)
  const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
  return generator(astNode.children[0] as unknown as types.Node).code
}

const i18n = {
  internationalization: {
    main: { name: 'English', locale: 'en' },
    languages: { en: 'English', ro: 'Romanian' } as Record<string, string>,
  },
}

const slugByLocale = {
  type: 'dynamic' as const,
  content: { referenceType: 'prop' as const, refPath: ['blogPost', 'slugByLocale'] },
}

describe('hreflang with a slug per locale', () => {
  it('reads each locale’s own slug from the row, falling back to the route parameter', async () => {
    const code = await runPlugin(
      {
        assets: [
          {
            type: 'canonical',
            path: 'https://acme.example/blog/[slug]',
            localizedParams: { slug: slugByLocale },
          },
        ],
      },
      i18n
    )
    expect(code).toContain(
      `hrefLang="ro" href={\`https://acme.example/ro/blog/\${props?.blogPost?.slugByLocale?.["ro"] ?? router.query.slug}\`}`
    )
    expect(code).toContain(
      `hrefLang="en" href={\`https://acme.example/blog/\${props?.blogPost?.slugByLocale?.["en"] ?? router.query.slug}\`}`
    )
    expect(code).toContain(
      `hrefLang="x-default" href={\`https://acme.example/blog/\${props?.blogPost?.slugByLocale?.["en"] ?? router.query.slug}\`}`
    )
  })

  it('keeps the route parameter alone for a page without localized values', async () => {
    const code = await runPlugin(
      { assets: [{ type: 'canonical', path: 'https://acme.example/blog/[slug]' }] },
      i18n
    )
    expect(code).toContain(
      `hrefLang="ro" href={\`https://acme.example/ro/blog/\${router.query.slug}\`}`
    )
  })
})

describe('a paged listing', () => {
  it('names the page in the canonical and og:url from the second page on', async () => {
    const code = await runPlugin({
      assets: [{ type: 'canonical', path: 'https://acme.example/blog', pageParam: 'page' }],
    })
    const suffix = `Number(router.query.page) > 1 ? \`?page=\${router.query.page}\` : ""`
    expect(code).toContain(`rel="canonical" href={"https://acme.example/blog" + (${suffix})}`)
    expect(code).toContain(`property="og:url" content={"https://acme.example/blog" + (${suffix})}`)
  })

  it('does the same under several locales', async () => {
    const code = await runPlugin(
      { assets: [{ type: 'canonical', path: 'https://acme.example/blog', pageParam: 'page' }] },
      i18n
    )
    expect(code).toContain(
      `rel="canonical" href={\`https://acme.example\${router.locale === router.defaultLocale ? "" : "/" + router.locale}/blog\` + (Number(router.query.page) > 1 ? \`?page=\${router.query.page}\` : "")}`
    )
  })
})
