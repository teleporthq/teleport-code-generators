/* tslint:disable:function-constructor */
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { PHOTO, PRINT_GROUPS, configured } from './_helpers/product-options-fixtures'

/**
 * The storefront cart provider and product options. A line bought with options
 * carries its answers (`configuration`, canonical) and their key; hydration
 * re-prices the options from the product's CURRENT definitions on the charged
 * base (variant override, then the product discount — options are never marked
 * down), stamps the label and flags a line whose answers no longer fit, and
 * never rewrites the answers or the key. A line without options — of a product
 * without options — comes out exactly as it always did.
 *
 * Everything here EXECUTES the emitted provider source, in strict mode as the
 * ES module it ships as.
 */

const settings = { paymentProviders: [] } as unknown as UIDLEcommerceSettings

type Line = Record<string, any>

const slice = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from)
  const end = source.indexOf(to, start + from.length)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

const emit = (cartDbEnabled = false) =>
  generateEcommerceContextFileContent(settings, undefined, 'ds-1', cartDbEnabled)

interface CartModule {
  enrichCartItems: (items: Line[]) => Promise<Line[]>
  tqCartKindRefusal: (items: Line[], item: Line) => Line | null
  tqSameCartLine: (line: Line, item: Line) => boolean
  tqWithLineConfiguration: (item: Line) => Line
  tqConfigurationFiles: (raw: unknown) => Line[]
}

// From the first helper the enrichment needs to the next top-level declaration:
// enrichment swallows its own errors, so a slice missing a helper would pass
// against a function that never ran.
const moduleSource = (source: string) => {
  const helpers = slice(source, 'function __pdRound2', 'function saveCartToStorage')
  expect(helpers).toContain('/* tq:po-helpers:start v1 */')
  expect(helpers).toContain('async function enrichCartItems')
  return helpers
}

function loadCart(rows: Line[], variants: Line[] = []): CartModule {
  return new Function(
    'rows',
    'variants',
    `'use strict'
    const PRODUCTS_DATA_SOURCE_ID = 'ds-1'
    const fetch = async (url) => {
      if (String(url).indexOf('/api/ecommerce/variants') === 0) {
        return { ok: true, json: async () => ({ variants }) }
      }
      return { ok: true, json: async () => ({ rows }) }
    }
    ${moduleSource(emit())}
    return { enrichCartItems, tqCartKindRefusal, tqSameCartLine, tqWithLineConfiguration, tqConfigurationFiles }`
  )(rows, variants)
}

const printRow = (extra: Line = {}): Line => ({
  id: 'print',
  name: 'Photo print',
  price: 10,
  currency: 'USD',
  option_groups: JSON.stringify(PRINT_GROUPS),
  ...extra,
})

const A3_GLOSSY = configured([
  { key: 'size', value: 'a3' },
  { key: 'paper', value: 'glossy' },
  { key: 'your-photo', value: [PHOTO] },
])
const A5_FINE_ART = configured([
  { key: 'size', value: 'a5' },
  { key: 'paper', value: 'fine-art' },
])
const A3_FINE_ART = configured([
  { key: 'size', value: 'a3' },
  { key: 'paper', value: 'fine-art' },
])

const printLine = (options: Line, extra: Line = {}): Line => ({
  id: 'l1',
  productId: 'print',
  quantity: 1,
  price: 10,
  name: 'Photo print',
  ...options,
  ...extra,
})

describe('cart provider — hydration re-prices a configured line', () => {
  it('prices the worked example: A3 + Glossy on a $10 print is $27', async () => {
    const [line] = await loadCart([printRow()]).enrichCartItems([printLine(A3_GLOSSY)])
    expect(line).toMatchObject({
      price: 27,
      basePrice: 10,
      configurationPriceDelta: 17,
      configurationLabel: 'Size: A3 · Paper: Glossy · Your photo: IMG_2231.jpg',
      configurationStale: false,
      configuration: A3_GLOSSY.configuration,
      configurationKey: A3_GLOSSY.configurationKey,
      originalPrice: null,
    })
  })

  it('takes a percentage of the DISCOUNTED base, and marks down the base only', async () => {
    const discounts = JSON.stringify([
      { id: 'd1', type: 'percentage', value: 10, startsAt: null, endsAt: null },
    ])
    const [line] = await loadCart([printRow({ discounts })]).enrichCartItems([
      printLine(A3_FINE_ART),
    ])
    // Charged base 9; A3 +9; Fine-art 40% of 9 = 3.60.
    expect(line).toMatchObject({
      price: 21.6,
      basePrice: 9,
      configurationPriceDelta: 12.6,
      originalPrice: 22.6,
      discountAmount: 1,
    })
  })

  it('takes a percentage of the VARIANT price', async () => {
    const [line] = await loadCart(
      [printRow()],
      [{ id: 'v-large', product_id: 'print', price: 20, options: {} }]
    ).enrichCartItems([printLine(A5_FINE_ART, { variantId: 'v-large' })])
    expect(line).toMatchObject({ price: 28, basePrice: 20, configurationPriceDelta: 8 })
  })

  it('flags a line whose chosen value was removed, charging nothing for it', async () => {
    const removed = configured([
      { key: 'size', value: 'a2' },
      { key: 'paper', value: 'matte' },
    ])
    const [line] = await loadCart([printRow()]).enrichCartItems([printLine(removed, { price: 25 })])
    expect(line).toMatchObject({ price: 10, configurationStale: true, configurationPriceDelta: 0 })
    expect(line.configuration).toBe(removed.configuration)
  })

  it('charges no option prices on a gift card or a subscription product', async () => {
    for (const extra of [{ is_gift_card: 't' }, { payment_type: 'recurring' }]) {
      const [line] = await loadCart([printRow(extra)]).enrichCartItems([printLine(A3_GLOSSY)])
      expect(line).toMatchObject({
        price: 10,
        configurationPriceDelta: 0,
        configurationStale: false,
      })
    }
  })

  it('flags a line without answers once the product requires some', async () => {
    const [line] = await loadCart([printRow()]).enrichCartItems([printLine({})])
    expect(line).toMatchObject({
      price: 10,
      basePrice: 10,
      configurationLabel: '',
      configurationPriceDelta: 0,
      configurationStale: true,
    })
    expect(line.configuration).toBeUndefined()
    expect(line.configurationKey).toBeUndefined()
  })

  it('never rewrites the answers or their key', async () => {
    const reordered = printLine({
      configuration: '[{"key":"size","value":"a3"},{"key":"paper","value":"glossy"}]',
      configurationKey: 'not-the-hash',
    })
    const [line] = await loadCart([printRow()]).enrichCartItems([reordered])
    expect(line.configuration).toBe(reordered.configuration)
    expect(line.configurationKey).toBe('not-the-hash')
    expect(line.price).toBe(27)
  })

  it('returns an unchanged configured cart by reference', async () => {
    const cart = loadCart([printRow()])
    const first = await cart.enrichCartItems([printLine(A3_GLOSSY)])
    expect(await cart.enrichCartItems(first)).toBe(first)
  })

  it('leaves a line without options of a product without options exactly as before', async () => {
    const mug = { id: 'mug', name: 'Mug', price: 12, currency: 'USD', slug: 'mug' }
    const line = { id: 'l-mug', productId: 'mug', quantity: 2, price: 12, name: 'Mug' }
    const [enriched] = await loadCart([mug]).enrichCartItems([line])
    expect(enriched).toEqual({
      id: 'l-mug',
      productId: 'mug',
      quantity: 2,
      name: 'Mug',
      price: 12,
      image: null,
      variant: '',
      variantSwatches: [],
      currency: 'USD',
      currencySymbol: null,
      slug: 'mug',
      originalPrice: null,
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      categoryIds: [],
      isGiftCard: false,
      isRecurring: false,
      recurringInterval: null,
      recurringIntervalCount: null,
      trialDays: null,
      isDigital: false,
    })
  })
})

describe('cart provider — a configured line is its own line', () => {
  const cart = loadCart([])

  it('matches on product, variant and identical answers', () => {
    const line = printLine(A3_GLOSSY)
    expect(cart.tqSameCartLine(line, printLine(A3_GLOSSY))).toBe(true)
    expect(cart.tqSameCartLine(line, printLine(A5_FINE_ART))).toBe(false)
    expect(cart.tqSameCartLine(line, printLine({}))).toBe(false)
    expect(
      cart.tqSameCartLine(
        line,
        printLine({ ...A5_FINE_ART, configurationKey: A3_GLOSSY.configurationKey })
      )
    ).toBe(false)
    expect(cart.tqSameCartLine(printLine({}), printLine({}))).toBe(true)
  })

  it('refuses a second configuration of the one subscription', () => {
    const plan = { productId: 'plan', variantId: null, isRecurring: true }
    const inCart = [{ ...plan, id: 'l1', ...A3_GLOSSY }]
    expect(cart.tqCartKindRefusal(inCart, { ...plan, ...A5_FINE_ART })).toMatchObject({
      added: false,
      reason: 'one-subscription',
    })
    expect(cart.tqCartKindRefusal(inCart, { ...plan, ...A3_GLOSSY })).toMatchObject({
      reason: 'one-subscription',
    })
  })

  it('lets another configuration of a physical product join', () => {
    const inCart = [printLine(A3_GLOSSY)]
    expect(cart.tqCartKindRefusal(inCart, printLine(A5_FINE_ART))).toBeNull()
  })

  it('normalises a caller’s answers to the canonical string and computes the key', () => {
    const answers = [
      { key: 'paper', value: 'fine-art' },
      { key: 'size', value: 'a5' },
    ]
    expect(cart.tqWithLineConfiguration({ productId: 'print', configuration: answers })).toEqual({
      productId: 'print',
      ...A5_FINE_ART,
    })
    expect(
      cart.tqWithLineConfiguration({
        productId: 'print',
        configuration: JSON.stringify(answers),
        configurationKey: 'k'.repeat(70),
      })
    ).toEqual({
      productId: 'print',
      configuration: A5_FINE_ART.configuration,
      configurationKey: 'k'.repeat(64),
    })
    expect(cart.tqWithLineConfiguration({ productId: 'mug', configurationKey: 'stray' })).toEqual({
      productId: 'mug',
      configuration: '',
      configurationKey: '',
    })
  })

  it('lists only safe https files, at most ten, with an image flag', () => {
    const file = (id: string, url: string, mimeType = 'image/png') => ({
      id,
      name: id + '.png',
      size: 10,
      url,
      mimeType,
    })
    const raw = JSON.stringify([
      {
        key: 'art',
        value: [
          file('ok', 'https://files.example.com/ok.png'),
          file('pdf', 'https://files.example.com/brief.pdf', 'application/pdf'),
          file('js', 'javascript:alert(1)'),
          file('data', 'data:image/png;base64,AAAA'),
          file('plain', 'http://files.example.com/plain.png'),
        ],
      },
      { key: 'size', value: 'a3' },
    ])
    expect(cart.tqConfigurationFiles(raw)).toEqual([
      { name: 'ok.png', url: 'https://files.example.com/ok.png', isImage: 'true' },
      { name: 'pdf.png', url: 'https://files.example.com/brief.pdf', isImage: 'false' },
    ])
    const many = JSON.stringify([
      {
        key: 'art',
        value: Array.from({ length: 12 }, (_v, i) =>
          file('f' + i, 'https://files.example.com/' + i)
        ),
      },
    ])
    expect(cart.tqConfigurationFiles(many)).toHaveLength(10)
    expect(cart.tqConfigurationFiles('')).toEqual([])
    expect(cart.tqConfigurationFiles(undefined)).toEqual([])
  })
})

describe('cart provider — what the cart pages bind', () => {
  const loadProjection = () => {
    const source = emit()
    const moneyHelpers = slice(source, 'function roundMoney', 'function computeCartMeta')
    const projection = slice(source, 'const displayCartItems = useMemo', 'const cartCurrencySymbol')
    return new Function(
      'cartItems',
      `'use strict'
      const useMemo = (compute) => compute()
      ${moduleSource(source)}
      ${moneyHelpers}
      ${projection}
      return displayCartItems`
    ) as (cartItems: Line[]) => Line[]
  }

  it('publishes the four option fields on every line, as strings and safe files', () => {
    const project = loadProjection()
    const [plain, withOptions, stale, plainStale] = project([
      { id: 'l-mug', productId: 'mug', quantity: 1, price: 12 },
      printLine(A3_GLOSSY, {
        price: 27,
        configurationLabel: 'Size: A3 · Paper: Glossy · Your photo: IMG_2231.jpg',
        configurationStale: false,
      }),
      printLine(A5_FINE_ART, { configurationLabel: 'Size: A5', configurationStale: true }),
      // No answers, but its product now requires one: hydration flags it and
      // the checkout refuses it, so the line surfaces must show the stale note,
      // which sits inside the block `hasConfiguration` opens.
      { id: 'l-mug2', productId: 'mug', quantity: 1, price: 12, configurationStale: true },
    ])
    expect(plain).toMatchObject({
      hasConfiguration: 'false',
      configurationLabel: '',
      configurationStale: 'false',
      configurationFiles: [],
    })
    expect(plainStale).toMatchObject({
      hasConfiguration: 'true',
      configurationStale: 'true',
      configurationLabel: '',
      configurationFiles: [],
    })
    expect(withOptions).toMatchObject({
      hasConfiguration: 'true',
      configurationLabel: 'Size: A3 · Paper: Glossy · Your photo: IMG_2231.jpg',
      configurationStale: 'false',
      configurationFiles: [{ name: 'IMG_2231.jpg', url: PHOTO.url, isImage: 'true' }],
      unitPrice: '27.00',
    })
    expect(stale).toMatchObject({ hasConfiguration: 'true', configurationStale: 'true' })
  })

  it('drops the stale note once the product has no options left', async () => {
    // A plain line flagged while its product required an option; the merchant
    // then removed every option, so the checkout takes the line as it is.
    const mug = { id: 'mug', name: 'Mug', price: 12, currency: 'USD', option_groups: '[]' }
    const plain = { id: 'l-mug', productId: 'mug', quantity: 1, price: 12, name: 'Mug' }
    const flagged = await loadCart([
      { ...mug, option_groups: JSON.stringify(PRINT_GROUPS) },
    ]).enrichCartItems([plain])
    expect(flagged[0]).toMatchObject({ basePrice: 12, configurationStale: true })
    const cart = loadCart([mug])
    const healed = await cart.enrichCartItems(flagged)
    expect(healed).not.toBe(flagged)
    expect(healed[0]).toMatchObject({ price: 12, originalPrice: null })
    for (const field of [
      'basePrice',
      'configurationLabel',
      'configurationPriceDelta',
      'configurationStale',
    ]) {
      expect(healed[0][field] == null).toBe(true)
    }
    const [line] = loadProjection()(healed)
    expect(line).toMatchObject({
      hasConfiguration: 'false',
      configurationStale: 'false',
      configurationLabel: '',
    })
    // Healed once: the next hydration leaves it alone.
    expect(await cart.enrichCartItems(healed)).toBe(healed)
  })

  it('publishes the same four fields when the store prices by region', () => {
    const regionalSettings = {
      paymentProviders: [],
      regionalPricing: { enabled: true, currency: 'EUR', countryCodes: {}, storeCountryCode: null },
    } as unknown as UIDLEcommerceSettings
    const source = generateEcommerceContextFileContent(regionalSettings, undefined, 'ds-1')
    const projection = slice(source, 'const displayCartItems = useMemo', 'const cartCurrencySymbol')
    expect(projection).toContain('regionalLinePricing(regionalQuote, item, index)')
    for (const field of [
      "hasConfiguration: item.configurationKey || item.configurationStale === true ? 'true' : 'false',",
      "configurationLabel: item.configurationLabel || '',",
      "configurationStale: item.configurationStale === true ? 'true' : 'false',",
      'configurationFiles: tqConfigurationFiles(item.configuration),',
    ]) {
      expect(projection).toContain(field)
    }
  })
})

describe('cart provider — addToCart', () => {
  // `price` stands in for hydration: what `enrichCartItems` answers for a cart.
  const loadAddToCart = (initial: Line[], price: (items: Line[]) => Line[] = (items) => items) => {
    const source = emit()
    const cart = loadCart([])
    const state = { items: initial.slice(), saved: [] as Line[][], enriched: [] as Line[][] }
    const addToCart = new Function(
      'helpers',
      'state',
      'price',
      `'use strict'
      const { tqWithLineConfiguration, tqCartKindRefusal, tqSameCartLine } = helpers
      const useCallback = (fn) => fn
      const cartItemsRef = { get current() { return state.items } }
      const setCartItems = (update) => { state.items = typeof update === 'function' ? update(state.items) : update }
      const setCartMeta = () => {}
      const computeCartMeta = () => ({})
      const saveCartToStorage = (items) => { state.saved.push(items) }
      const enrichCartItems = (items) => { state.enriched.push(items); return Promise.resolve(price(items)) }
      const maxQtyPerProduct = null
      ${slice(source, 'const addToCart = useCallback((input) => {', 'const removeFromCart')}
      return addToCart`
    )(cart, state, price) as (item: Line) => Line | undefined
    return { addToCart, state }
  }
  const settle = () => new Promise((resolve) => setImmediate(resolve))
  const priceConfigured = (items: Line[]) =>
    items.map((line) => (line.configurationKey ? { ...line, price: 27 } : line))

  it('adds one line per configuration, increments the same answers, and prices keyed lines', () => {
    const { addToCart, state } = loadAddToCart([])
    addToCart({
      productId: 'print',
      quantity: 1,
      price: 10,
      configuration: A3_GLOSSY.configuration,
    })
    addToCart({ productId: 'print', quantity: 1, price: 10, ...A3_GLOSSY })
    addToCart({
      productId: 'print',
      quantity: 1,
      price: 10,
      configuration: JSON.parse(A5_FINE_ART.configuration),
    })
    addToCart({ productId: 'print', quantity: 1, price: 10 })
    expect(state.items.map((line) => [line.quantity, line.configurationKey || ''])).toEqual([
      [2, A3_GLOSSY.configurationKey],
      [1, A5_FINE_ART.configurationKey],
      [1, ''],
    ])
    expect(state.items[0].configuration).toBe(A3_GLOSSY.configuration)
    // Only a keyed add asks hydration to price the line.
    expect(state.enriched).toHaveLength(3)
    expect(Object.keys(state.items[2]).sort()).toEqual(
      ['id', 'image', 'name', 'price', 'productId', 'quantity', 'variantId'].sort()
    )
  })

  it('prices the added line once hydration answers, unless the cart changed meanwhile', async () => {
    const priced = loadAddToCart([], priceConfigured)
    priced.addToCart({ productId: 'print', quantity: 1, price: 10, ...A3_GLOSSY })
    await settle()
    expect(priced.state.items.map((line) => line.price)).toEqual([27])
    expect(priced.state.saved[priced.state.saved.length - 1]).toBe(priced.state.items)

    const changed = loadAddToCart([], priceConfigured)
    changed.addToCart({ productId: 'print', quantity: 1, price: 10, ...A3_GLOSSY })
    changed.addToCart({ productId: 'mug', quantity: 1, price: 12 })
    const afterSecondAdd = changed.state.items
    await settle()
    expect(changed.state.items).toBe(afterSecondAdd)
    expect(changed.state.items.map((line) => [line.productId, line.price])).toEqual([
      ['print', 10],
      ['mug', 12],
    ])
  })

  it('gives two configurations added in the same millisecond their own ids', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const { addToCart, state } = loadAddToCart([])
      addToCart({ productId: 'print', quantity: 1, price: 10, ...A3_GLOSSY })
      addToCart({ productId: 'print', quantity: 1, price: 10, ...A5_FINE_ART })
      addToCart({ productId: 'mug', quantity: 1, price: 12 })
      expect(state.items.map((line) => line.id)).toEqual([
        'print__' + A3_GLOSSY.configurationKey + '_1000',
        'print__' + A5_FINE_ART.configurationKey + '_1000',
        'mug_1000',
      ])
    } finally {
      now.mockRestore()
    }
  })

  it('answers the kind refusal without touching the cart', () => {
    const plan = { id: 'l1', productId: 'plan', quantity: 1, isRecurring: true, ...A3_GLOSSY }
    const { addToCart, state } = loadAddToCart([plan])
    expect(addToCart({ productId: 'plan', isRecurring: true, ...A5_FINE_ART })).toMatchObject({
      added: false,
      reason: 'one-subscription',
    })
    expect(state.items).toEqual([plan])
  })

  it('keeps the currency it was handed, and refuses a line priced in another', () => {
    const { addToCart, state } = loadAddToCart([])
    addToCart({ productId: 'mug', quantity: 1, price: 12, currency: 'RON', currencySymbol: 'lei' })
    expect(state.items).toMatchObject([
      { productId: 'mug', currency: 'RON', currencySymbol: 'lei' },
    ])
    expect(addToCart({ productId: 'tea', quantity: 1, price: 5, currency: 'USD' })).toMatchObject({
      added: false,
      reason: 'mixed-currency',
    })
    expect(state.items.map((line) => line.productId)).toEqual(['mug'])
    addToCart({ productId: 'tea', quantity: 1, price: 5, currency: 'RON' })
    expect(state.items.map((line) => line.productId)).toEqual(['mug', 'tea'])
    // A caller that states no currency adds a line without one.
    addToCart({ productId: 'cup', quantity: 1, price: 3 })
    expect(state.items[2]).not.toHaveProperty('currency')
  })
})

describe('cart provider — database cart', () => {
  const source = emit(true)

  it('sends the answers of configured lines only', async () => {
    const bodies: Line[] = []
    const persist = new Function(
      'bodies',
      `'use strict'
      const window = {}
      const emailLocale = { getClientLocale: () => 'en' }
      const getOrCreateSessionId = () => 'session-1'
      const fetch = (url, init) => { bodies.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => ({ ok: true }) }) }
      ${slice(source, 'function persistCartToDb(items) {', 'function roundMoney')}
      return persistCartToDb`
    )(bodies) as (items: Line[]) => Promise<unknown>
    await persist([
      { productId: 'mug', variantId: null, quantity: 2, price: 12 },
      printLine(A3_GLOSSY, { quantity: 3, configurationLabel: 'x' }),
    ])
    expect(bodies[0].items).toEqual([
      { productId: 'mug', variantId: null, quantity: 2 },
      {
        productId: 'print',
        variantId: null,
        quantity: 3,
        configuration: A3_GLOSSY.configuration,
        configurationKey: A3_GLOSSY.configurationKey,
      },
    ])
  })

  const loadApply = () => {
    const state = { items: [] as Line[] }
    const cart = loadCart([])
    const apply = new Function(
      'tqSameCartLine',
      'state',
      `'use strict'
      const useCallback = (fn) => fn
      const setCartItems = (items) => { state.items = items }
      const setCartMeta = () => {}
      const computeCartMeta = () => ({})
      const saveCartToStorage = () => {}
      const enrichCartItems = (items) => Promise.resolve(items)
      ${slice(source, 'const applyServerCart = useCallback(', 'const adoptMergedCart')}
      return applyServerCart`
    )(cart.tqSameCartLine, state) as (rows: Line[], keepLocal?: Line[] | null) => void
    return { apply, state }
  }

  it('keys a configured server line by product, variant and answers', () => {
    const { apply, state } = loadApply()
    apply([
      { productId: 'mug', variantId: null, quantity: 1 },
      { productId: 'print', variantId: 'v1', quantity: 2, ...A3_GLOSSY },
    ])
    expect(state.items).toEqual([
      { id: 'mug', productId: 'mug', variantId: null, quantity: 1 },
      {
        id: 'print__v1__' + A3_GLOSSY.configurationKey,
        productId: 'print',
        variantId: 'v1',
        quantity: 2,
        ...A3_GLOSSY,
      },
    ])
  })

  it('keeps the tab’s configured lines the server could not store', () => {
    const { apply, state } = loadApply()
    const localConfigured = printLine(A5_FINE_ART, { id: 'local-a5' })
    const alsoOnServer = printLine(A3_GLOSSY, { id: 'local-a3' })
    apply(
      [
        { productId: 'mug', variantId: null, quantity: 1 },
        { productId: 'print', variantId: null, quantity: 1, ...A3_GLOSSY },
      ],
      [{ id: 'local-mug', productId: 'mug', quantity: 5 }, localConfigured, alsoOnServer]
    )
    expect(state.items.map((line) => line.id)).toEqual([
      'mug',
      'print__' + A3_GLOSSY.configurationKey,
      'local-a5',
    ])
  })
})
