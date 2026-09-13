import { FileType, ProjectPluginStructure, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import {
  generateAssetUrlsModule,
  generateAssetsApiRoute,
} from '../src/ecommerce/asset-urls-generator'
import { generateOrderNotificationApiRoute } from '../src/ecommerce/ecommerce-api-routes-generator'

/**
 * A product image the merchant picked out of the project's asset library is
 * stored on `teleport_products.image_url` as the ASSET ID, not as a URL. Cart
 * hydration re-reads that column on every pass, so without resolution the cart
 * and checkout thumbnails render `<img src="<uuid>">` — the browser resolves it
 * against the site origin, asks for `/<uuid>`, and paints a broken image.
 *
 * These tests run the EMITTED code (the shared module, the provider's
 * `enrichCartItems`) rather than asserting on substrings of it, because the
 * failure they guard against is silent: enrichment swallows its own errors and
 * simply hands back the cart it was given.
 */

const settings = { paymentProviders: [] } as unknown as UIDLEcommerceSettings

const ASSET_ID = '960c8bad-111c-4178-9f22-ad60a59dd31e'
const ASSET_URL = 'https://cdn.example.com/assets/' + ASSET_ID
const OTHER_ASSET_ID = 'c5da44f2-fcea-4986-86cc-34bf54ee4889'
const OTHER_ASSET_URL = 'https://cdn.example.com/assets/' + OTHER_ASSET_ID

interface AssetUrlsModule {
  collectAssetLookupIds: (values: unknown[]) => string[]
  loadAssetUrlMapFromDb: (
    db: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> },
    values: unknown[]
  ) => Promise<Record<string, string | null>>
  resolveMediaUrl: (
    value: unknown,
    map: Record<string, string | null>,
    fallback?: unknown
  ) => string | null
  loadAssetUrlMap: (values: unknown[]) => Promise<Record<string, string | null>>
}

/** A `db` handle that answers the module's `teleport_assets` query from a table. */
const assetTableDb = (rows: Array<Record<string, unknown>>) => ({
  query: async (_sql: string, params: unknown[]) => {
    const ids = (params[0] as string[]) || []
    return { rows: rows.filter((row) => ids.indexOf(String(row.id)) !== -1) }
  },
})

type FetchStub = (url: string, init?: { body?: string }) => Promise<unknown>

/**
 * Evaluates the emitted `utils/ecommerce/asset-urls.js` with a stubbed global
 * `fetch`, and reports every lookup request it made so the caching and
 * cooldown behaviour can be asserted rather than assumed.
 */
function loadAssetUrlsModule(
  fetchStub: FetchStub,
  // The client half deliberately does nothing without a `window` — the endpoint
  // is relative, so there is no origin to resolve it against on the server. The
  // browser path is therefore evaluated WITH one; `serverSide` withholds it to
  // exercise that guard.
  options: { serverSide?: boolean } = {}
): {
  module: AssetUrlsModule
  requests: string[][]
} {
  const requests: string[][] = []
  const wrapped: FetchStub = (url, init) => {
    requests.push(JSON.parse((init && init.body) || '{"ids":[]}').ids)
    return fetchStub(url, init)
  }
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'fetch',
    'window',
    `const module = { exports: {} }
    ${generateAssetUrlsModule()}
    return module.exports`
  )
  return {
    module: factory(wrapped, options.serverSide ? undefined : {}) as AssetUrlsModule,
    requests,
  }
}

/** A `/api/ecommerce/assets` stub backed by a fixed id → URL table. */
const assetsEndpoint =
  (table: Record<string, string>, options: { fail?: boolean } = {}): FetchStub =>
  (_url, init) => {
    if (options.fail) {
      return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    }
    const ids: string[] = JSON.parse((init && init.body) || '{"ids":[]}').ids
    const assets: Record<string, string | null> = {}
    ids.forEach((id) => {
      assets[id] = table[id] || null
    })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ assets }) })
  }

interface CartLine {
  productId: string
  quantity: number
  name?: string
  image?: string | null
  [key: string]: unknown
}

interface ProductRow {
  id: string
  name: string
  price: number
  image_url?: string | null
  [key: string]: unknown
}

/**
 * Evaluates the emitted provider's `enrichCartItems` against a stubbed
 * `/api/data` response and the real emitted asset module, so what runs here is
 * the code that ships.
 */
function loadEnrich(
  rows: ProductRow[],
  assetTable: Record<string, string>,
  options: { assetLookupFails?: boolean } = {}
): (items: CartLine[]) => Promise<CartLine[]> {
  const source = generateEcommerceContextFileContent(
    settings,
    undefined,
    'ds-1',
    false,
    false,
    true
  )
  // From the discount helpers (emitted just above `enrichCartItems`, and used
  // by it) through to the next top-level declaration. Starting later would
  // leave `__pdResolveActive` undefined and enrichment swallows its own errors,
  // so the test would pass against a function that never ran.
  const start = source.indexOf('function __pdRound2')
  const end = source.indexOf('function saveCartToStorage')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const helpers = source.slice(start, end)
  expect(helpers).toContain('function enrichCartItems')

  const { module: assetUrls } = loadAssetUrlsModule(
    assetsEndpoint(assetTable, { fail: options.assetLookupFails })
  )

  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'rows',
    'loadAssetUrlMap',
    'resolveMediaUrl',
    `
    const PRODUCTS_DATA_SOURCE_ID = 'ds-1'
    const fetch = async (url) => {
      if (String(url).indexOf('/api/ecommerce/variants') === 0) {
        return { ok: true, json: async () => ({ variants: [] }) }
      }
      return { ok: true, json: async () => ({ rows }) }
    }
    ${helpers}
    return enrichCartItems
    `
  )
  return factory(rows, assetUrls.loadAssetUrlMap, assetUrls.resolveMediaUrl) as (
    items: CartLine[]
  ) => Promise<CartLine[]>
}

describe('emitted asset-url module', () => {
  it('only asks about values that are not already loadable URLs', () => {
    const { module } = loadAssetUrlsModule(assetsEndpoint({}))
    expect(
      module.collectAssetLookupIds([
        ASSET_ID,
        'https://images.example.com/a.jpg',
        'http://images.example.com/b.jpg',
        '//cdn.example.com/c.jpg',
        '/uploads/d.jpg',
        'data:image/png;base64,AAA',
        'blob:https://site/e',
        // A browser treats the scheme case-insensitively, so reading this as an
        // asset id would blank a picture that loads today.
        'HTTPS://images.example.com/f.jpg',
        ASSET_ID,
        '',
        null,
        undefined,
        42,
      ])
    ).toEqual([ASSET_ID])
  })

  it('records a requested id with no asset row as null, distinct from an absent key', async () => {
    const { module } = loadAssetUrlsModule(assetsEndpoint({}))
    const map = await module.loadAssetUrlMapFromDb(
      assetTableDb([
        { id: ASSET_ID, remote_src: ASSET_URL, image_src: null, src: null, url: null },
      ]),
      [ASSET_ID, OTHER_ASSET_ID]
    )
    expect(map).toEqual({ [ASSET_ID]: ASSET_URL, [OTHER_ASSET_ID]: null })
    expect(Object.prototype.hasOwnProperty.call(map, OTHER_ASSET_ID)).toBe(true)
  })

  it('never queries, and never fails, when nothing needs resolving', async () => {
    const { module } = loadAssetUrlsModule(assetsEndpoint({}))
    const exploding = {
      query: async () => {
        throw new Error('the mirror table does not exist')
      },
    }
    await expect(module.loadAssetUrlMapFromDb(exploding, ['https://a/b.png'])).resolves.toEqual({})
    // A real lookup on a store with no mirror table THROWS, so a caller whose
    // whole job is to answer can report that it could not.
    await expect(module.loadAssetUrlMapFromDb(exploding, [ASSET_ID])).rejects.toThrow()
  })

  it('reads the same teleport_assets column order as the data-source fetchers', async () => {
    const { module } = loadAssetUrlsModule(assetsEndpoint({}))
    const pick = async (row: Record<string, unknown>) =>
      (await module.loadAssetUrlMapFromDb(assetTableDb([row]), ['a'])).a
    expect(await pick({ id: 'a', remote_src: 'R', image_src: 'I', src: 'S', url: 'U' })).toBe('R')
    expect(await pick({ id: 'a', remote_src: null, image_src: 'I', src: 'S', url: 'U' })).toBe('I')
    expect(await pick({ id: 'a', remote_src: null, image_src: null, src: 'S', url: 'U' })).toBe('S')
    expect(await pick({ id: 'a', remote_src: null, image_src: null, src: null, url: 'U' })).toBe(
      'U'
    )
    expect(
      await pick({ id: 'a', remote_src: null, image_src: null, src: null, url: null })
    ).toBeNull()
  })

  it('never lets a bare asset id reach a rendered src, and keeps the known URL when the lookup cannot answer', () => {
    const { module } = loadAssetUrlsModule(assetsEndpoint({}))
    // Answered: the id becomes its URL.
    expect(module.resolveMediaUrl(ASSET_ID, { [ASSET_ID]: ASSET_URL })).toBe(ASSET_URL)
    // Answered "no such asset": the product has no image, not a broken one.
    expect(module.resolveMediaUrl(ASSET_ID, { [ASSET_ID]: null }, ASSET_URL)).toBeNull()
    // Unanswered (lookup down): the URL the line already carried survives.
    expect(module.resolveMediaUrl(ASSET_ID, {}, ASSET_URL)).toBe(ASSET_URL)
    // Unanswered with nothing to fall back on: absent beats a guaranteed 404.
    expect(module.resolveMediaUrl(ASSET_ID, {}, ASSET_ID)).toBeNull()
    expect(module.resolveMediaUrl(ASSET_ID, {})).toBeNull()
    // A stored URL never depends on the lookup at all.
    expect(module.resolveMediaUrl(ASSET_URL, {})).toBe(ASSET_URL)
  })

  it('asks once per id and never touches the network for a URL-only cart', async () => {
    const { module, requests } = loadAssetUrlsModule(
      assetsEndpoint({ [ASSET_ID]: ASSET_URL, [OTHER_ASSET_ID]: OTHER_ASSET_URL })
    )
    expect(await module.loadAssetUrlMap(['https://images.example.com/a.jpg'])).toEqual({})
    expect(requests).toHaveLength(0)

    expect(await module.loadAssetUrlMap([ASSET_ID])).toEqual({ [ASSET_ID]: ASSET_URL })
    expect(await module.loadAssetUrlMap([ASSET_ID, OTHER_ASSET_ID])).toEqual({
      [ASSET_ID]: ASSET_URL,
      [OTHER_ASSET_ID]: OTHER_ASSET_URL,
    })
    // The second pass only asked about the id the first one had not cached.
    expect(requests).toEqual([[ASSET_ID], [OTHER_ASSET_ID]])
  })

  it('shares one request between passes that overlap in flight', async () => {
    const { module, requests } = loadAssetUrlsModule(assetsEndpoint({ [ASSET_ID]: ASSET_URL }))
    const [first, second] = await Promise.all([
      module.loadAssetUrlMap([ASSET_ID]),
      module.loadAssetUrlMap([ASSET_ID]),
    ])
    expect(first).toEqual({ [ASSET_ID]: ASSET_URL })
    expect(second).toEqual({ [ASSET_ID]: ASSET_URL })
    expect(requests).toHaveLength(1)
  })

  it('does not reach for a relative endpoint during server rendering', async () => {
    // Node's global `fetch` exists but would reject on `/api/...`, and the
    // rejection would arm a cooldown in a module scope that outlives the
    // request — starving every browser this process then serves.
    const { module, requests } = loadAssetUrlsModule(assetsEndpoint({ [ASSET_ID]: ASSET_URL }), {
      serverSide: true,
    })
    await expect(module.loadAssetUrlMap([ASSET_ID])).resolves.toEqual({})
    expect(requests).toEqual([])
  })

  it('answers with what it knows when the lookup fails, and stops hammering a store that cannot answer', async () => {
    const { module, requests } = loadAssetUrlsModule(assetsEndpoint({}, { fail: true }))
    await expect(module.loadAssetUrlMap([ASSET_ID])).resolves.toEqual({})
    await expect(module.loadAssetUrlMap([ASSET_ID])).resolves.toEqual({})
    await expect(module.loadAssetUrlMap([OTHER_ASSET_ID])).resolves.toEqual({})
    // One doomed request, then the cooldown — not one per cart change.
    expect(requests).toEqual([[ASSET_ID]])
  })
})

describe('cart hydration — product images stored as project-asset ids', () => {
  it('resolves the stored id so the cart and checkout thumbnails have a real URL', async () => {
    const enrich = loadEnrich([{ id: 'p1', name: 'Shirt', price: 75, image_url: ASSET_ID }], {
      [ASSET_ID]: ASSET_URL,
    })
    const [line] = await enrich([{ productId: 'p1', quantity: 1 }])
    expect(line.image).toBe(ASSET_URL)
  })

  it('leaves a stored URL exactly as it is', async () => {
    const stockPhoto = 'https://images.pexels.com/photos/1/x.jpeg'
    const enrich = loadEnrich([{ id: 'p1', name: 'Shirt', price: 75, image_url: stockPhoto }], {})
    const [line] = await enrich([{ productId: 'p1', quantity: 1 }])
    expect(line.image).toBe(stockPhoto)
  })

  it('keeps the already-resolved URL on the line when the lookup is unavailable', async () => {
    const enrich = loadEnrich(
      [{ id: 'p1', name: 'Shirt', price: 75, image_url: ASSET_ID }],
      {},
      {
        assetLookupFails: true,
      }
    )
    const [line] = await enrich([{ productId: 'p1', quantity: 1, name: 'Shirt', image: ASSET_URL }])
    expect(line.image).toBe(ASSET_URL)
  })

  it('reports a deleted asset as no image rather than a broken one', async () => {
    // The endpoint answers, and answers "there is no such asset".
    const enrich = loadEnrich([{ id: 'p1', name: 'Shirt', price: 75, image_url: ASSET_ID }], {})
    const [line] = await enrich([{ productId: 'p1', quantity: 1, name: 'Shirt', image: ASSET_URL }])
    expect(line.image).toBeNull()
  })

  it('prefers the variant image over the product image, resolving it the same way', async () => {
    const source = generateEcommerceContextFileContent(
      settings,
      undefined,
      'ds-1',
      false,
      false,
      true
    )
    const helpers = source.slice(
      source.indexOf('function __pdRound2'),
      source.indexOf('function saveCartToStorage')
    )
    const { module: assetUrls } = loadAssetUrlsModule(
      assetsEndpoint({ [OTHER_ASSET_ID]: OTHER_ASSET_URL })
    )
    // tslint:disable-next-line:function-constructor
    const factory = new Function(
      'loadAssetUrlMap',
      'resolveMediaUrl',
      `
      const PRODUCTS_DATA_SOURCE_ID = 'ds-1'
      const fetch = async (url) => {
        if (String(url).indexOf('/api/ecommerce/variants') === 0) {
          return {
            ok: true,
            json: async () => ({
              variants: [{ id: 'v1', options: {}, price: 80, image_url: '${OTHER_ASSET_ID}' }],
            }),
          }
        }
        return {
          ok: true,
          json: async () => ({
            rows: [{ id: 'p1', name: 'Shirt', price: 75, image_url: '${ASSET_ID}' }],
          }),
        }
      }
      ${helpers}
      return enrichCartItems
      `
    )
    const enrich = factory(assetUrls.loadAssetUrlMap, assetUrls.resolveMediaUrl) as (
      items: CartLine[]
    ) => Promise<CartLine[]>
    const [line] = await enrich([{ productId: 'p1', variantId: 'v1', quantity: 1 }])
    expect(line.image).toBe(OTHER_ASSET_URL)
    expect(line.price).toBe(80)
  })

  it('refuses to render an id hydration could not clean up', () => {
    // A line whose product row was DELETED is returned untouched by
    // enrichment — there is nothing left to re-read it from — so a cart written
    // before this resolution existed keeps its bare id. The display projection
    // is the last place that can stop `<img src="<uuid>">` reaching the page.
    const source = generateEcommerceContextFileContent(
      settings,
      undefined,
      'ds-1',
      false,
      false,
      true
    )
    const start = source.indexOf('const displayCartItems = useMemo')
    const end = source.indexOf('const cartCurrencySymbol', start)
    expect(start).toBeGreaterThan(-1)
    const projection = source.slice(start, end)
    expect(projection).toContain('image: isDirectAssetUrl(item.image) ? item.image : null,')
  })

  it('re-renders only when something moved — an already-resolved cart comes back by reference', async () => {
    const enrich = loadEnrich([{ id: 'p1', name: 'Shirt', price: 75, image_url: ASSET_ID }], {
      [ASSET_ID]: ASSET_URL,
    })
    const items: CartLine[] = [
      {
        productId: 'p1',
        quantity: 1,
        name: 'Shirt',
        price: 75,
        image: ASSET_URL,
        variant: '',
        currency: null,
        currencySymbol: null,
        slug: null,
        originalPrice: null,
        discountType: null,
        discountValue: null,
        discountAmount: 0,
      },
    ]
    expect(await enrich(items)).toBe(items)
  })
})

describe('NextEcommerceProjectPlugin — asset resolution wiring', () => {
  const buildStructure = (dataSourceType: string): ProjectPluginStructure => {
    const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
    files.set('_app', {
      path: ['pages'],
      files: [
        {
          name: '_app',
          fileType: FileType.JS,
          content:
            'function MyApp({ Component, pageProps }) { return <Component {...pageProps} /> }',
        },
      ],
    })
    return {
      uidl: {
        globals: { env: {} },
        ecommerceSettings: { paymentProviders: [] },
        dataSources: { 'ds-1': { type: dataSourceType, config: { connectionString: 'x' } } },
      },
      files,
      dependencies: {},
      devDependencies: {},
    } as unknown as ProjectPluginStructure
  }

  it('emits the module and the route together, and imports the module only then', async () => {
    const structure = buildStructure('teleport')
    await new NextEcommerceProjectPlugin().runAfter(structure)

    const moduleFile = structure.files.get('ecommerce-asset-urls')
    expect(moduleFile?.path).toEqual(['utils', 'ecommerce'])
    expect(moduleFile?.files?.[0]?.name).toBe('asset-urls')

    const routeFile = structure.files.get('ecommerce-api-assets')
    expect(routeFile?.path).toEqual(['pages', 'api', 'ecommerce'])
    expect(routeFile?.files?.[0]?.name).toBe('assets')
    // The route owns the request handling; the SQL and the id → URL mapping
    // live in the module both halves share.
    expect(routeFile?.files?.[0]?.content).toContain(
      "require('../../../utils/ecommerce/asset-urls')"
    )
    expect(routeFile?.files?.[0]?.content).toContain('loadAssetUrlMapFromDb(db, ids)')
    expect(moduleFile?.files?.[0]?.content).toContain('FROM teleport_assets')

    const context = structure.files.get('ecommerce-context')?.files?.[0] as { content: string }
    expect(context.content).toContain(
      "import { isDirectAssetUrl, loadAssetUrlMap, resolveMediaUrl } from './utils/ecommerce/asset-urls'"
    )
    // The display projection is the last gate before a stored value becomes an
    // `<img src>`, and it refuses anything that is not a URL.
    expect(context.content).toContain('image: isDirectAssetUrl(item.image) ? item.image : null,')
  })

  it('never imports a module it did not write', async () => {
    // MySQL has no `teleport_assets` mirror and no `$1`/`ANY()` dialect, so the
    // route cannot be emitted — and an import of a missing module would fail
    // the build outright.
    const structure = buildStructure('mysql')
    await new NextEcommerceProjectPlugin().runAfter(structure)

    expect(structure.files.get('ecommerce-asset-urls')).toBeUndefined()
    expect(structure.files.get('ecommerce-api-assets')).toBeUndefined()
    expect(generateAssetsApiRoute('mysql', { connectionString: 'x' })).toBeNull()

    const context = structure.files.get('ecommerce-context')?.files?.[0] as { content: string }
    expect(context.content).not.toContain('utils/ecommerce/asset-urls')
    expect(context.content).toContain('function enrichCartItems')
  })

  it('resolves the order-notification email thumbnails, and only where the module exists', () => {
    const notificationSettings = {
      orderNotifications: true,
      orderNotificationConfig: {
        provider: 'resend',
        notificationEmails: ['owner@example.com'],
        subject: 'New order',
        body: 'An order came in.',
      },
      paymentProviders: [],
    } as unknown as UIDLEcommerceSettings
    const config = { connectionString: 'x' }

    // An email has no origin to resolve a bare id against, so the line loader
    // turns it into an absolute URL before it reaches an `<img src>`.
    const withDb = generateOrderNotificationApiRoute(
      notificationSettings,
      'teleport',
      config,
      undefined
    )
    expect(withDb).toContain("require('../../../utils/ecommerce/asset-urls')")
    expect(withDb).toContain('assetUrls.loadAssetUrlMapFromDb(db, imageValues)')
    expect(withDb).toContain("assetUrls.resolveMediaUrl(row.image_url, assetUrlMap) || ''")

    // MySQL emits neither the loader nor the module, so the route must not
    // reach for either — an import of a file the plugin never wrote fails the
    // build outright.
    const withoutDb = generateOrderNotificationApiRoute(
      notificationSettings,
      'mysql',
      config,
      undefined
    )
    expect(withoutDb).not.toContain('asset-urls')
    expect(withoutDb).not.toContain('assetUrls.')
  })

  it('does not import the module into the settings-less fallback context', () => {
    const fallback = generateEcommerceContextFileContent(
      {} as UIDLEcommerceSettings,
      undefined,
      null,
      false,
      false,
      false
    )
    expect(fallback).not.toContain('utils/ecommerce/asset-urls')
  })
})
