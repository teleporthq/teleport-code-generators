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
  redirect?: {
    destinationField: string
    typeField?: string
    unlessFieldEquals?: { field: string; value: string }
    ownRowsFilter?: Array<Record<string, unknown>>
    statusCode?: 301 | 302 | 307 | 308
  }
  skipI18n?: boolean
  revalidate?: number
  resourceParams?: Record<string, unknown>
}): ComponentStructure => {
  const { redirect, skipI18n, revalidate, resourceParams } = params
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
          resource: { id: RESOURCE_ID, params: resourceParams || {} },
          ...(revalidate ? { cache: { revalidate } } : {}),
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

describe('teleport-plugin-next-static-props: two rows at one address', () => {
  const OWN_ROWS = [
    { type: 'condition', source: 'product_page', destination: 'personalise', operand: '=' },
  ]
  const productPage = (ownRowsFilter?: Array<Record<string, unknown>>) =>
    makeStructure({
      redirect: {
        destinationField: 'productPageUrl',
        unlessFieldEquals: { field: 'productPageKey', value: 'personalise' },
        ...(ownRowsFilter ? { ownRowsFilter } : {}),
        statusCode: 302,
      },
      revalidate: 60,
      resourceParams: {
        filters: {
          type: 'expr',
          content:
            'JSON.stringify([{ type: "condition", source: "slug", destination: params.slug, operand: "=" }])',
        },
        limit: { type: 'static', content: 1 },
      },
    })

  // Two products may share a slug on different product pages: the page shows
  // its own one, and redirects only when it has none at that address.
  it('looks for an own row at the address before sending the visitor on', async () => {
    const code = await generateCode(productPage(OWN_ROWS))
    expect(code).toContain(
      'if (String(response?.data?.[0]?.productPageKey ?? "") !== "personalise") {'
    )
    expect(code).toContain('const ownRowsResponse = await')
    expect(code).toContain('"filters": JSON.stringify(JSON.parse(JSON.stringify([{')
    expect(code).toContain('.concat([{')
    expect(code).toContain('destination: "personalise"')
    expect(code).toContain('response.data = ownRowsResponse.data')
    expect(code.indexOf('ownRowsResponse')).toBeLessThan(code.indexOf('entityRedirectUrl'))
    expect(code.indexOf('notFound')).toBeLessThan(code.indexOf('ownRowsResponse'))
  })

  it('never redirects while pre-rendering: the path answers 404 until it revalidates', async () => {
    const code = await generateCode(productPage(OWN_ROWS))
    const redirectCheck = code.indexOf('if (entityRedirectUrl)')
    const buildCheck = code.indexOf('process.env.NEXT_PHASE === "phase-production-build"')
    expect(buildCheck).toBeGreaterThan(redirectCheck)
    expect(buildCheck).toBeLessThan(code.indexOf('redirect: {'))
  })

  it('leaves a page without the own-rows filter, and the blog redirects, as they were', async () => {
    const withoutFilter = await generateCode(productPage())
    expect(withoutFilter).not.toContain('ownRowsResponse')
    const blog = await generateCode(
      makeStructure({ redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' } })
    )
    expect(blog).not.toContain('ownRowsResponse')
    expect(blog).not.toContain('NEXT_PHASE')
  })

  it('keeps the props return the only top-level return', async () => {
    const plugin = createStaticPropsPlugin()
    const result = await plugin(productPage(OWN_ROWS))
    const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
    const fn = (chunk?.content as types.ExportNamedDeclaration)
      .declaration as types.FunctionDeclaration
    const tryStmt = fn.body.body.find(
      (statement): statement is types.TryStatement => statement.type === 'TryStatement'
    )
    expect(
      tryStmt!.block.body.filter((statement) => statement.type === 'ReturnStatement')
    ).toHaveLength(1)
  })
})

describe('teleport-plugin-next-static-props: entity redirect', () => {
  // A page that shows a SUBSET of a table's rows (a custom product page shows
  // the products assigned to it): every other row is sent to its own page,
  // with a temporary status because a row can move back.
  it('redirects only while the row belongs to another page, with the status asked for', async () => {
    const code = await generateCode(
      makeStructure({
        redirect: {
          destinationField: 'productPageUrl',
          unlessFieldEquals: { field: 'productPageKey', value: 'personalise' },
          statusCode: 302,
        },
        revalidate: 60,
      })
    )

    expect(code).toContain(
      'const entityRedirectUrl = String(response?.data?.[0]?.productPageKey ?? "") !== "personalise" ? response?.data?.[0]?.productPageUrl : undefined'
    )
    expect(code).toContain('statusCode: 302')
    expect(code).toContain('revalidate: 60')
    expect(code.indexOf('notFound')).toBeLessThan(code.indexOf('entityRedirectUrl'))
  })

  it('keeps the standard product page own products: its key is empty', async () => {
    const code = await generateCode(
      makeStructure({
        redirect: {
          destinationField: 'productPageUrl',
          unlessFieldEquals: { field: 'productPageKey', value: '' },
          statusCode: 302,
        },
      })
    )
    expect(code).toContain('String(response?.data?.[0]?.productPageKey ?? "") !== ""')
  })

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

  /*
    Without `revalidate`, an ISR entry has NO expiry: Next.js caches the branch
    it took and never runs getStaticProps for that path again. A page that
    redirected once would redirect for ever — clearing `redirect_url` in the
    admin would change the row and change nothing a visitor sees — and a row
    that 404'd would stay 404 after being published. Every branch carries the
    window, not just the one that renders: the missing row, the redirect, the
    props and the failed fetch.
  */
  it('gives the redirect and the notFound the same revalidate window as the props', async () => {
    const code = await generateCode(
      makeStructure({
        redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' },
        revalidate: 60,
      })
    )

    expect(code.match(/revalidate: 60/g)).toHaveLength(4)
    const redirectAt = code.indexOf('if (entityRedirectUrl)')
    const propsAt = code.indexOf('props:')
    // The one between the redirect check and the props return is the redirect's.
    expect(code.indexOf('revalidate: 60', redirectAt)).toBeLessThan(propsAt)
  })

  it('emits no revalidate anywhere when the page has no cache window', async () => {
    const code = await generateCode(
      makeStructure({ redirect: { destinationField: 'redirectUrl', typeField: 'redirectType' } })
    )
    expect(code).not.toContain('revalidate')
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
