import generator from '@babel/generator'
import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

// Entity-level redirects (`initialPropsData.redirect`): a details page whose
// fetched row carries a destination answers with an HTTP redirect instead of
// rendering. Two invariants matter beyond the emitted shape:
//  - the redirect must live INSIDE an IfStatement — several later plugins
//    (addDynamicSeoPropsToGetStaticProps, the parallel/inline-fetch plugins)
//    locate the props return via `.find((s) => s.type === 'ReturnStatement')`
//    on the try block, so a second top-level return would derail them;
//  - `statusCode` (not `permanent`) is emitted, because Next.js maps
//    `permanent: true/false` to 308/307 while the feature promises 301/302.

const RESOURCE_ID = 'fetch-blog-post'

const makeStructure = (params: {
  redirect?: { destinationField: string; typeField?: string }
  skipI18n?: boolean
}): ComponentStructure => {
  const { redirect, skipI18n } = params
  return {
    uidl: {
      name: 'BlogPostDetails',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: 'page-blog-post-details',
        folderPath: ['blog'],
        fileName: '[slug]',
        initialPropsData: {
          exposeAs: { name: 'blogPost', valuePath: ['data', '0'] },
          resource: { id: RESOURCE_ID, params: {} },
          ...(redirect ? { redirect } : {}),
        },
      },
    },
    chunks: [],
    dependencies: {},
    options: {
      skipI18n,
      resources: {
        items: {
          [RESOURCE_ID]: { id: RESOURCE_ID, name: 'blog-post' },
        },
        path: ['utils', 'data-sources'],
      },
    },
  } as unknown as ComponentStructure
}

const generateCode = async (structure: ComponentStructure): Promise<string> => {
  const plugin = createStaticPropsPlugin()
  const result = await plugin(structure)
  const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
  expect(chunk).toBeDefined()
  return generator(chunk?.content as types.Node).code
}

describe('teleport-plugin-next-static-props: entity redirect', () => {
  it('emits a statusCode redirect between the notFound check and the props return', async () => {
    const code = await generateCode(
      makeStructure({ redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' } })
    )

    expect(code).toContain('const entityRedirectUrl = response?.data?.[0]?.redirectUrl')
    expect(code).toContain('if (entityRedirectUrl)')
    expect(code).toContain('statusCode: response?.data?.[0]?.redirectType === "302" ? 302 : 301')
    expect(code).not.toContain('permanent')

    // The 404 for a missing row must win over the redirect check.
    expect(code.indexOf('notFound')).toBeLessThan(code.indexOf('entityRedirectUrl'))
    expect(code.indexOf('entityRedirectUrl')).toBeLessThan(code.indexOf('props:'))
  })

  it('keeps the props return as the ONLY top-level ReturnStatement in the try block', async () => {
    const plugin = createStaticPropsPlugin()
    const result = await plugin(
      makeStructure({ redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' } })
    )
    const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
    const exportDecl = chunk?.content as types.ExportNamedDeclaration
    const fn = exportDecl.declaration as types.FunctionDeclaration
    const tryStmt = fn.body.body.find(
      (statement): statement is types.TryStatement => statement.type === 'TryStatement'
    )
    expect(tryStmt).toBeDefined()

    const topLevelReturns = tryStmt!.block.body.filter(
      (statement) => statement.type === 'ReturnStatement'
    )
    expect(topLevelReturns).toHaveLength(1)

    // And the one `.find(ReturnStatement)` later plugins run must land on the
    // props return, not the redirect.
    const found = tryStmt!.block.body.find(
      (statement) => statement.type === 'ReturnStatement'
    ) as types.ReturnStatement
    const foundCode = generator(found).code
    expect(foundCode).toContain('props:')
  })

  it('prefixes internal destinations with the active non-default locale when i18n is on', async () => {
    const code = await generateCode(
      makeStructure({ redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' } })
    )

    expect(code).toContain('context?.locale')
    expect(code).toContain('context?.defaultLocale')
    expect(code).toContain('entityRedirectUrl.startsWith("/")')
    // tslint:disable-next-line:no-invalid-template-strings
    expect(code).toContain('`/${context.locale}${entityRedirectUrl}`')
  })

  it('uses the destination as-is when i18n is skipped', async () => {
    const code = await generateCode(
      makeStructure({
        redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' },
        skipI18n: true,
      })
    )

    expect(code).toContain('destination: entityRedirectUrl')
    expect(code).not.toContain('entityRedirectUrl.startsWith')
  })

  it('defaults to a permanent 301 when no typeField is configured', async () => {
    const code = await generateCode(
      makeStructure({ redirect: { destinationField: 'redirectUrl' } })
    )

    expect(code).toContain('statusCode: 301')
    expect(code).not.toContain('redirectType')
  })

  it('emits no redirect code at all without a redirect config (regression guard)', async () => {
    const code = await generateCode(makeStructure({}))

    expect(code).not.toContain('entityRedirectUrl')
    expect(code).not.toContain('redirect')
  })
})
