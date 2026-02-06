import * as types from '@babel/types'
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

    // Should have: 1 canonical + 2 hreflang (ro, en) + 1 x-default = 4 link tags
    expect(helmetNode.children.length).toBe(4)

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
    const roLink = helmetNode.children[1] as types.JSXElement
    const roHreflang = roLink.openingElement.attributes[1] as types.JSXAttribute
    const roHref = roLink.openingElement.attributes[2] as types.JSXAttribute
    expect((roHreflang.value as types.StringLiteral).value).toBe('ro')
    expect((roHref.value as types.StringLiteral).value).toBe('https://example.com/about/')

    // hreflang="en" should point to locale-prefixed URL
    const enLink = helmetNode.children[2] as types.JSXElement
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

    // x-default is the last child
    const xDefaultLink = helmetNode.children[3] as types.JSXElement
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

    // Only 1 child: the static canonical link (no hreflang tags)
    expect(helmetNode.children.length).toBe(1)

    const linkNode = helmetNode.children[0] as types.JSXElement
    const relAttr = linkNode.openingElement.attributes[0] as types.JSXAttribute
    const hrefAttr = linkNode.openingElement.attributes[1] as types.JSXAttribute
    expect((relAttr.value as types.StringLiteral).value).toBe('canonical')
    expect((hrefAttr.value as types.StringLiteral).value).toBe('https://example.com/')

    // useRouter should NOT be added
    expect(structure.dependencies.useRouter).toBeUndefined()
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

    // Only 1 child: static canonical, no hreflang
    expect(helmetNode.children.length).toBe(1)
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
})
