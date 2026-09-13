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
  UIDLComponentSEO,
} from '@teleporthq/teleport-types'

// Per-entity SEO overrides on details pages:
//  - a dynamic metaTag whose reference carries a `fallback` renders
//    `content={props?.x?.y ?? '<fallback>'}` (without it an unset row leaves a
//    content-less robots meta behind);
//  - a canonical asset's `dynamicOverride` wraps the WHOLE page-level href in
//    `props?.x?.canonicalUrl || <fallback>` — in every branch (static, dynamic
//    route, multi-locale), and mirrored on og:url.

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
        closingElement: {
          type: 'JSXClosingElement',
          name: { type: 'JSXIdentifier', name: 'div' },
        },
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
  const helmetNode = astNode.children[0] as types.JSXElement
  return generator(helmetNode as unknown as types.Node).code
}

describe('plugin-jsx-head-config: per-entity SEO overrides', () => {
  it('renders a dynamic meta content with its fallback via ??', async () => {
    const code = await runPlugin({
      metaTags: [
        {
          name: 'robots',
          content: {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: 'root',
              refPath: ['blogPost', 'robotsContent'],
              fallback: 'index, follow',
            },
          },
        },
      ],
    } as unknown as UIDLComponentSEO)

    expect(code).toContain('props?.blogPost?.robotsContent ?? "index, follow"')
  })

  it('renders a dynamic meta content without fallback as the bare chain (unchanged behavior)', async () => {
    const code = await runPlugin({
      metaTags: [
        {
          name: 'robots',
          content: {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: 'root',
              refPath: ['blogPost', 'robotsContent'],
            },
          },
        },
      ],
    } as unknown as UIDLComponentSEO)

    expect(code).toContain('props?.blogPost?.robotsContent')
    expect(code).not.toContain('??')
  })

  it('wraps a dynamic-route canonical (and og:url) with the entity override', async () => {
    const code = await runPlugin({
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/blog/[slug]',
          dynamicOverride: {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: 'root',
              refPath: ['blogPost', 'canonicalUrl'],
            },
          },
        },
      ],
    } as unknown as UIDLComponentSEO)

    expect(code).toContain(
      // tslint:disable-next-line:no-invalid-template-strings
      'href={props?.blogPost?.canonicalUrl || `https://example.com/blog/${router.query.slug}`}'
    )
    expect(code).toContain(
      // tslint:disable-next-line:no-invalid-template-strings
      'content={props?.blogPost?.canonicalUrl || `https://example.com/blog/${router.query.slug}`}'
    )
  })

  it('wraps a fully static canonical with the entity override', async () => {
    const code = await runPlugin({
      assets: [
        {
          type: 'canonical',
          path: 'https://example.com/about',
          dynamicOverride: {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: 'root',
              refPath: ['blogPost', 'canonicalUrl'],
            },
          },
        },
      ],
    } as unknown as UIDLComponentSEO)

    expect(code).toContain('href={props?.blogPost?.canonicalUrl || "https://example.com/about"}')
  })

  it('keeps a static canonical byte-identical when no override is present (regression guard)', async () => {
    const code = await runPlugin({
      assets: [{ type: 'canonical', path: 'https://example.com/about' }],
    } as unknown as UIDLComponentSEO)

    expect(code).toContain('href="https://example.com/about"')
    expect(code).toContain('content="https://example.com/about"')
    expect(code).not.toContain('||')
  })

  it('wraps the multi-locale canonical template whole — the override is never spliced into it', async () => {
    const code = await runPlugin(
      {
        assets: [
          {
            type: 'canonical',
            path: 'https://example.com/blog/[slug]',
            dynamicOverride: {
              type: 'dynamic',
              content: {
                referenceType: 'prop',
                id: 'root',
                refPath: ['blogPost', 'canonicalUrl'],
              },
            },
          },
        ],
      } as unknown as UIDLComponentSEO,
      {
        internationalization: {
          languages: { en: 'English', fr: 'French' },
          main: { locale: 'en', name: 'English' },
        },
      } as unknown as ComponentStructure['options']
    )

    expect(code).toContain('props?.blogPost?.canonicalUrl || `https://example.com${')
    // hreflang alternates stay page-derived — no override leaks into them.
    const hreflangSection = code.slice(code.indexOf('hrefLang'))
    expect(hreflangSection).not.toContain('canonicalUrl')
  })
})
