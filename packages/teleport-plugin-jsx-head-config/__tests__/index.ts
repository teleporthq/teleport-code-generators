import * as types from '@babel/types'
import generator from '@babel/generator'
import { createJSXHeadConfigPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
} from '@teleporthq/teleport-types'

describe('plugin-jsx-head-config', () => {
  const plugin = createJSXHeadConfigPlugin()
  const jsxChunk: ChunkDefinition = {
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
          closingElement: {
            type: 'JSXClosingElement',
            name: { type: 'JSXIdentifier', name: 'div' },
          },
          children: [],
        },
      },
    },
  }

  it('Should throw error when the chunk is supplied', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [],
      dependencies: {},
    }
    try {
      await plugin(structure)
    } catch (e) {
      expect(e.message).toContain('JSX component chunk with name')
    }
  })

  it('Should set the title in the <Helmet> component', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      title: 'Test Title',
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsxChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
    expect(astNode.children.length).toBe(1)

    const helmetNode = astNode.children[0] as types.JSXElement
    expect((helmetNode.openingElement.name as types.JSXIdentifier).name).toBe('Helmet')

    const titleNode = helmetNode.children[0] as types.JSXElement
    const titleText = titleNode.children[0] as types.JSXText
    expect((titleNode.openingElement.name as types.JSXIdentifier).name).toBe('title')
    expect(titleText.value).toBe('Test Title')
  })

  it('Should set the meta tags in the <Helmet> component', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      metaTags: [
        {
          name: 'description',
          value: 'test',
        },
        {
          randomKey: 'randomValue',
        },
      ],
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsxChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
    expect(astNode.children.length).toBe(2)

    const helmetNode = astNode.children[0] as types.JSXElement
    expect((helmetNode.openingElement.name as types.JSXIdentifier).name).toBe('Helmet')

    const firstMetaNode = helmetNode.children[0] as types.JSXElement
    const secondMetaNode = helmetNode.children[1] as types.JSXElement

    const nameAttribute = firstMetaNode.openingElement.attributes[0] as types.JSXAttribute
    const valueAttribute = firstMetaNode.openingElement.attributes[1] as types.JSXAttribute
    expect((nameAttribute.name as types.JSXIdentifier).name).toBe('name')
    expect((nameAttribute.value as types.StringLiteral).value).toBe('description')
    expect((valueAttribute.name as types.JSXIdentifier).name).toBe('value')
    expect((valueAttribute.value as types.StringLiteral).value).toBe('test')

    const randomKeyAttribute = secondMetaNode.openingElement.attributes[0] as types.JSXAttribute
    expect((randomKeyAttribute.name as types.JSXIdentifier).name).toBe('randomKey')
    expect((randomKeyAttribute.value as types.StringLiteral).value).toBe('randomValue')
  })

  it('Should set the link tag in the <Helmet> for canonical', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://teleporthq.io',
        },
      ],
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsxChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    expect((helmetNode.openingElement.name as types.JSXIdentifier).name).toBe('Helmet')

    const linkNode = helmetNode.children[0] as types.JSXElement

    const relAttribute = linkNode.openingElement.attributes[0] as types.JSXAttribute
    const hrefAttribute = linkNode.openingElement.attributes[1] as types.JSXAttribute
    expect((relAttribute.name as types.JSXIdentifier).name).toBe('rel')
    expect((relAttribute.value as types.StringLiteral).value).toBe('canonical')
    expect((hrefAttribute.name as types.JSXIdentifier).name).toBe('href')
    expect((hrefAttribute.value as types.StringLiteral).value).toBe('https://teleporthq.io')
  })

  const createFreshJsxChunk = (): ChunkDefinition => ({
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
          closingElement: {
            type: 'JSXClosingElement',
            name: { type: 'JSXIdentifier', name: 'div' },
          },
          children: [],
        },
      },
    },
  })

  const i18nOptions = {
    internationalization: {
      main: { name: 'Romanian', locale: 'ro' },
      languages: { ro: 'Romanian', en: 'English' } as Record<string, string>,
    },
  }

  it('Should generate hreflang tags and dynamic canonical when i18n has multiple locales', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/about/',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: i18nOptions,
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // Should have: 1 canonical + 1 og:url + 2 hreflang (ro, en) + 1 x-default = 5 tags
    expect(helmetNode.children.length).toBe(5)

    // Canonical link should have dynamic href (JSXExpressionContainer, not StringLiteral)
    const canonicalNode = helmetNode.children[0] as types.JSXElement
    const canonicalRel = canonicalNode.openingElement.attributes[0] as types.JSXAttribute
    expect((canonicalRel.value as types.StringLiteral).value).toBe('canonical')
    const canonicalHref = canonicalNode.openingElement.attributes[1] as types.JSXAttribute
    expect(canonicalHref.value.type).toBe('JSXExpressionContainer')

    // useRouter should be added to dependencies
    expect(structure.dependencies.useRouter).toBeDefined()
    expect(structure.dependencies.useRouter.path).toBe('next/router')
  })

  it('Should generate self-referential hreflang for each locale', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/about/',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: i18nOptions,
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // hreflang="ro" should point to default locale URL (no prefix)
    const roLink = helmetNode.children[2] as types.JSXElement
    const roHreflang = roLink.openingElement.attributes[1] as types.JSXAttribute
    const roHref = roLink.openingElement.attributes[2] as types.JSXAttribute
    expect((roHreflang.value as types.StringLiteral).value).toBe('ro')
    expect((roHref.value as types.StringLiteral).value).toBe('https://example.com/about/')

    // hreflang="en" should point to locale-prefixed URL
    const enLink = helmetNode.children[3] as types.JSXElement
    const enHreflang = enLink.openingElement.attributes[1] as types.JSXAttribute
    const enHref = enLink.openingElement.attributes[2] as types.JSXAttribute
    expect((enHreflang.value as types.StringLiteral).value).toBe('en')
    expect((enHref.value as types.StringLiteral).value).toBe('https://example.com/en/about/')
  })

  it('Should generate x-default hreflang pointing to default locale URL', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: i18nOptions,
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // x-default is the last child (after canonical, og:url, ro hreflang, en hreflang)
    const xDefaultLink = helmetNode.children[4] as types.JSXElement
    const xDefaultHreflang = xDefaultLink.openingElement.attributes[1] as types.JSXAttribute
    const xDefaultHref = xDefaultLink.openingElement.attributes[2] as types.JSXAttribute
    expect((xDefaultHreflang.value as types.StringLiteral).value).toBe('x-default')
    expect((xDefaultHref.value as types.StringLiteral).value).toBe('https://example.com/')
  })

  it('Should keep static canonical when no i18n is present', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // 2 children: the static canonical link + og:url meta (no hreflang tags)
    expect(helmetNode.children.length).toBe(2)

    const linkNode = helmetNode.children[0] as types.JSXElement
    const relAttr = linkNode.openingElement.attributes[0] as types.JSXAttribute
    const hrefAttr = linkNode.openingElement.attributes[1] as types.JSXAttribute
    expect((relAttr.value as types.StringLiteral).value).toBe('canonical')
    expect((hrefAttr.value as types.StringLiteral).value).toBe('https://example.com/')

    const ogUrlMeta = helmetNode.children[1] as types.JSXElement
    const ogProperty = ogUrlMeta.openingElement.attributes[0] as types.JSXAttribute
    const ogContent = ogUrlMeta.openingElement.attributes[1] as types.JSXAttribute
    expect((ogProperty.value as types.StringLiteral).value).toBe('og:url')
    expect((ogContent.value as types.StringLiteral).value).toBe('https://example.com/')

    // useRouter should NOT be added
    expect(structure.dependencies.useRouter).toBeUndefined()
  })

  it('Should interpolate a Next.js [id] segment in the canonical and og:url', async () => {
    // A details page's canonical path is the ROUTE TEMPLATE (`/rsvp-event/[id]`).
    // Emitted verbatim it publishes a URL that 404s for every crawler and every
    // shared link, so it has to become `${router.query.id}`.
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/rsvp-event/[id]',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    expect(helmetNode.children.length).toBe(2)

    const canonicalNode = helmetNode.children[0] as types.JSXElement
    const canonicalHref = canonicalNode.openingElement.attributes[1] as types.JSXAttribute
    expect(canonicalHref.value.type).toBe('JSXExpressionContainer')
    const canonicalCode = generator(
      (canonicalHref.value as types.JSXExpressionContainer).expression as types.Expression
    ).code
    expect(canonicalCode).toContain('router.query.id')
    expect(canonicalCode).not.toContain('[id]')

    const ogUrlMeta = helmetNode.children[1] as types.JSXElement
    const ogContent = ogUrlMeta.openingElement.attributes[1] as types.JSXAttribute
    expect(ogContent.value.type).toBe('JSXExpressionContainer')
    const ogCode = generator(
      (ogContent.value as types.JSXExpressionContainer).expression as types.Expression
    ).code
    expect(ogCode).toContain('router.query.id')
    expect(ogCode).not.toContain('[id]')

    expect(structure.dependencies.useRouter).toBeDefined()
  })

  it('Should keep static canonical when i18n has only one language', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/',
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {
        internationalization: {
          main: { name: 'Romanian', locale: 'ro' },
          languages: { ro: 'Romanian' },
        },
      },
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // 2 children: static canonical + og:url meta, no hreflang
    expect(helmetNode.children.length).toBe(2)
    expect(structure.dependencies.useRouter).toBeUndefined()
  })

  it('Should not generate hreflang tags when no canonical is present', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      title: 'Test Page',
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: i18nOptions,
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement

    // Only 1 child: the title tag (no hreflang since no canonical)
    expect(helmetNode.children.length).toBe(1)
    const titleNode = helmetNode.children[0] as types.JSXElement
    expect((titleNode.openingElement.name as types.JSXIdentifier).name).toBe('title')
    expect(structure.dependencies.useRouter).toBeUndefined()
  })

  const codeOf = (node: types.Node) => generator(node).code

  it('Should interpolate a route parameter inside a pre-serialized JSON-LD document', async () => {
    // A BreadcrumbList's last `item` is the page's own URL. For a details page
    // that URL is the ROUTE TEMPLATE, so shipping the document verbatim
    // published `https://example.com/event-details/[id]` — a URL no crawler can
    // follow — inside structured data search engines actually parse.
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      structuredData: [
        '{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":2,"item":"https://example.com/event-details/[id]"}]}',
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    const code = generator(helmetNode).code

    expect(code).toContain('router.query.id')
    expect(code).not.toContain('[id]')
    expect(structure.dependencies.useRouter).toBeDefined()
  })

  it('Should emit a static JSON-LD script verbatim', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    const ld = '{"@context":"https://schema.org","@type":"Organization","name":"Acme"}'
    uidlSample.seo = { structuredData: [ld] }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    const scriptNode = helmetNode.children[0] as types.JSXElement
    expect((scriptNode.openingElement.name as types.JSXIdentifier).name).toBe('script')

    const code = codeOf(scriptNode)
    expect(code).toContain('type="application/ld+json"')
    expect(code).toContain('dangerouslySetInnerHTML')
    // emitted as a (quote-escaped) string literal containing the raw JSON
    expect(code).toContain('@type')
    expect(code).toContain('Organization')
    // a static string is emitted verbatim, not wrapped in JSON.stringify
    expect(code).not.toContain('JSON.stringify')
  })

  it('Should emit a dynamic Product JSON-LD bound to entity props', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      structuredData: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: {
            type: 'dynamic',
            content: { referenceType: 'prop', id: 'root', refPath: ['ecommerceProduct', 'name'] },
          },
          offers: {
            '@type': 'Offer',
            priceCurrency: {
              type: 'dynamic',
              content: {
                referenceType: 'prop',
                id: 'root',
                refPath: ['ecommerceProduct', 'currency'],
              },
            },
            availability: {
              type: 'computed',
              kind: 'availability',
              refPath: ['ecommerceProduct'],
              column: 'quantity',
            },
            itemCondition: {
              type: 'computed',
              kind: 'itemCondition',
              refPath: ['ecommerceProduct'],
              column: 'condition',
            },
          },
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    const scriptNode = helmetNode.children[0] as types.JSXElement
    const code = codeOf(scriptNode)

    expect(code).toContain('JSON.stringify')
    expect(code).toContain('props?.ecommerceProduct?.name')
    expect(code).toContain('props?.ecommerceProduct?.currency')
    // availability ternary
    expect(code).toContain('props?.ecommerceProduct?.quantity === 0')
    expect(code).toContain('https://schema.org/OutOfStock')
    expect(code).toContain('https://schema.org/InStock')
    // itemCondition map lookup with default
    expect(code).toContain('https://schema.org/NewCondition')
    // </script> breakout guard
    expect(code).toMatch(/\.replace\(\/<\/g/)
  })

  it('Should emit multiple JSON-LD scripts', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      structuredData: ['{"@type":"WebSite"}', '{"@type":"Organization"}'],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    expect(helmetNode.children.length).toBe(2)
    expect((helmetNode.children[0] as types.JSXElement).openingElement.name).toMatchObject({
      name: 'script',
    })
    expect((helmetNode.children[1] as types.JSXElement).openingElement.name).toMatchObject({
      name: 'script',
    })
  })

  it('Should not change output when no structuredData is present', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = { title: 'Plain' }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    // only the title tag — no script tags
    expect(helmetNode.children.length).toBe(1)
    expect((helmetNode.children[0] as types.JSXElement).openingElement.name).toMatchObject({
      name: 'title',
    })
  })

  it('Should add the translations hook for a locale-bound JSON-LD leaf', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      structuredData: [
        {
          '@type': 'WebSite',
          name: { type: 'dynamic', content: { referenceType: 'locale', id: 'site.name' } },
        },
      ],
    }

    const freshChunk = createFreshJsxChunk()
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [freshChunk],
      dependencies: {},
    }

    await plugin(structure)

    expect(structure.dependencies.useTranslations).toBeDefined()
    const astNode = freshChunk.meta.nodesLookup.container as types.JSXElement
    const helmetNode = astNode.children[0] as types.JSXElement
    const code = codeOf(helmetNode.children[0] as types.JSXElement)
    expect(code).toContain('translate.raw("site.name")')
  })
})
