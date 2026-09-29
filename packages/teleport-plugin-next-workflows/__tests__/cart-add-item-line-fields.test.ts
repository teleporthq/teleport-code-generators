/* tslint:disable:function-constructor */
import { ProductOptions } from '@teleporthq/teleport-shared'
import { cartAddItem } from '../src/nodes/cart/cart-add-item'
import { resolveHandlerEntryName } from '../src/nodes/types'

/**
 * `cart-add-item` writes the line the discount engine later prices, so it has
 * to carry what the engine reads besides the price: the product's category ids
 * (assigned plus ancestors) and whether it IS a gift card. Both are re-stamped
 * on every add, like the markdown fields — a product moved to another category
 * or turned into a gift card must re-price on the next add, and the empty list
 * and `false` are the values that say "none".
 */

interface AddToCartResult {
  id: string
  productId: string
  quantity: number
  added: boolean
}

type Handler = (config: Record<string, unknown>) => Promise<AddToCartResult>

function loadHandler(store: Record<string, string>): Handler {
  ;(global as any).localStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value
    },
  }
  ;(global as any).window = { dispatchEvent: () => true }
  ;(global as any).CustomEvent = function CustomEvent() {
    return {}
  }
  const source = cartAddItem.generateHandler()
  return new Function('config', `${source}\nreturn cart_add_item(config)`) as Handler
}

const storedCart = (store: Record<string, string>): Array<Record<string, unknown>> =>
  JSON.parse(store.workflow_cart)

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).window
  delete (global as any).CustomEvent
})

describe('cart-add-item — the fields the discount engine prices by', () => {
  it('still resolves its entry point', () => {
    expect(resolveHandlerEntryName(cartAddItem.generateHandler(), 'cart-add-item')).toBe(
      'cart_add_item'
    )
  })

  it('stamps categories and the gift-card flag onto a new line', async () => {
    const store: Record<string, string> = {}
    await loadHandler(store)({
      productId: 'p1',
      quantity: 1,
      price: 10,
      categoryIds: ['c1', 'root'],
      isGiftCard: 'true',
    })
    expect(storedCart(store)[0]).toMatchObject({
      productId: 'p1',
      categoryIds: ['c1', 'root'],
      isGiftCard: true,
    })
  })

  it('accepts the raw JSON column and a config boolean in every spelling', async () => {
    // Gift cards are a kind of their own, so the cards and the goods go in
    // two carts: a card is refused beside goods, and goods beside a card.
    const cards: Record<string, string> = {}
    const cardHandler = loadHandler(cards)
    await cardHandler({
      productId: 'p1',
      price: 10,
      categoryIds: '["c1", "", null]',
      isGiftCard: true,
    })
    await cardHandler({ productId: 'p2', price: 10, categoryIds: 'not json', isGiftCard: 't' })
    const cardCart = storedCart(cards)
    expect(cardCart[0]).toMatchObject({ categoryIds: ['c1'], isGiftCard: true })
    expect(cardCart[1]).toMatchObject({ categoryIds: [], isGiftCard: true })

    const goods: Record<string, string> = {}
    const goodsHandler = loadHandler(goods)
    await goodsHandler({ productId: 'p3', price: 10, isGiftCard: 'false' })
    await goodsHandler({ productId: 'p4', price: 10 })
    const goodsCart = storedCart(goods)
    expect(goodsCart[0]).toMatchObject({ categoryIds: [], isGiftCard: false })
    expect(goodsCart[1]).toMatchObject({ categoryIds: [], isGiftCard: false })
  })

  it('re-stamps both on an existing line, back to "none" included', async () => {
    const store: Record<string, string> = {
      workflow_cart: JSON.stringify([
        {
          id: 'cart_1',
          productId: 'p1',
          variantId: null,
          quantity: 1,
          price: 10,
          categoryIds: ['old'],
          isGiftCard: true,
        },
      ]),
    }
    const result = await loadHandler(store)({ productId: 'p1', quantity: 1, price: 10 })
    expect(result).toEqual({ id: 'cart_1', productId: 'p1', quantity: 2, added: true })
    expect(storedCart(store)[0]).toMatchObject({ categoryIds: [], isGiftCard: false })
  })
})

/**
 * A product with options: the add-to-cart workflow prices the shopper's answers
 * and hands the node the canonical configuration, its key, the label, the
 * surcharge and the charged base. The configuration is part of the line's
 * identity, and a line WITHOUT options must stay exactly the line it was.
 */
describe('cart-add-item — configured lines', () => {
  const po = new Function(
    `${ProductOptions.generateProductOptionsHelperCode()}\nreturn { canonical: __poCanonical, key: __poKey };`
  )() as { canonical: (entries: unknown) => string; key: (entries: unknown) => string }
  const configured = (answers: Array<{ key: string; value: unknown }>) => ({
    configuration: po.canonical(answers),
    configurationKey: po.key(answers),
  })
  const A3_GLOSSY = configured([
    { key: 'size', value: 'a3' },
    { key: 'paper', value: 'glossy' },
  ])
  const A5_MATTE = configured([
    { key: 'size', value: 'a5' },
    { key: 'paper', value: 'matte' },
  ])
  const printAdd = (options: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    productId: 'print',
    quantity: 1,
    price: 27,
    basePrice: 10,
    configurationPriceDelta: 17,
    configurationLabel: 'Size: A3 · Paper: Glossy',
    ...options,
    ...extra,
  })

  it('keeps a plain line byte-identical: the same keys as before, and the same answer', async () => {
    const store: Record<string, string> = {}
    const result = await loadHandler(store)({ productId: 'mug', quantity: 2, price: 12 })
    expect(Object.keys(result).sort()).toEqual(['added', 'id', 'productId', 'quantity'])
    expect(Object.keys(storedCart(store)[0])).toEqual([
      'id',
      'productId',
      'variantId',
      'quantity',
      'name',
      'price',
      'image',
      'currency',
      'currencySymbol',
      'slug',
      'originalPrice',
      'discountType',
      'discountValue',
      'discountAmount',
      'categoryIds',
      'isGiftCard',
      'isRecurring',
      'recurringInterval',
      'recurringIntervalCount',
      'trialDays',
      'isDigital',
    ])
    // A key or a label without a configuration is no configuration at all.
    const stray = await loadHandler(store)({
      productId: 'mug',
      quantity: 1,
      price: 12,
      configuration: '',
      configurationKey: 'aaaaaaaaaaaaaaaa',
      configurationLabel: 'x',
    })
    expect(stray).toEqual({
      id: storedCart(store)[0].id,
      productId: 'mug',
      quantity: 3,
      added: true,
    })
    expect(storedCart(store)).toHaveLength(1)
    expect(storedCart(store)[0].configurationKey).toBeUndefined()
  })

  it('stamps the five fields on a configured line and answers its key', async () => {
    const store: Record<string, string> = {}
    const result = await loadHandler(store)(printAdd(A3_GLOSSY))
    expect(result).toMatchObject({
      added: true,
      quantity: 1,
      configurationKey: A3_GLOSSY.configurationKey,
    })
    expect(A3_GLOSSY.configurationKey).toMatch(/^[0-9a-f]{16}$/)
    expect(storedCart(store)[0]).toMatchObject({
      productId: 'print',
      price: 27,
      configuration: A3_GLOSSY.configuration,
      configurationKey: A3_GLOSSY.configurationKey,
      configurationLabel: 'Size: A3 · Paper: Glossy',
      configurationPriceDelta: 17,
      basePrice: 10,
    })
  })

  it('makes two lines of two configurations, and increments the same configuration', async () => {
    const store: Record<string, string> = {}
    const handler = loadHandler(store)
    await handler(printAdd(A3_GLOSSY))
    await handler(
      printAdd(A5_MATTE, {
        price: 10,
        configurationPriceDelta: 0,
        configurationLabel: 'Size: A5 · Paper: Matte',
      })
    )
    const again = await handler(printAdd(A3_GLOSSY, { quantity: 2 }))
    const cart = storedCart(store)
    expect(cart).toHaveLength(2)
    expect(again).toMatchObject({ id: cart[0].id, quantity: 3 })
    expect(cart.map((line) => line.quantity)).toEqual([3, 1])
    // A plain add of the same product is a third line, never merged into either.
    await handler({ productId: 'print', quantity: 1, price: 10 })
    expect(storedCart(store)).toHaveLength(3)
  })

  it('never merges on the key alone: the configuration must be identical too', async () => {
    const store: Record<string, string> = {}
    const handler = loadHandler(store)
    await handler(printAdd(A3_GLOSSY))
    await handler(
      printAdd({
        configuration: A5_MATTE.configuration,
        configurationKey: A3_GLOSSY.configurationKey,
      })
    )
    expect(storedCart(store)).toHaveLength(2)
  })

  it('re-stamps the label, surcharge and base on the existing line', async () => {
    const store: Record<string, string> = {}
    const handler = loadHandler(store)
    await handler(printAdd(A3_GLOSSY))
    await handler(
      printAdd(A3_GLOSSY, {
        price: 29,
        basePrice: 11,
        configurationPriceDelta: 18,
        configurationLabel: 'Size: A3 · Paper: High gloss',
      })
    )
    expect(storedCart(store)[0]).toMatchObject({
      quantity: 2,
      price: 29,
      basePrice: 11,
      configurationPriceDelta: 18,
      configurationLabel: 'Size: A3 · Paper: High gloss',
    })
  })

  it('stringifies an array configuration and derives the base from the price', async () => {
    const store: Record<string, string> = {}
    const answers = [{ key: 'size', value: 'a4' }]
    await loadHandler(store)({
      productId: 'print',
      price: 14,
      configuration: answers,
      configurationKey: po.key(answers),
      configurationPriceDelta: '4',
      configurationLabel: 'Size: A4',
    })
    expect(storedCart(store)[0]).toMatchObject({
      configuration: JSON.stringify(answers),
      configurationPriceDelta: 4,
      basePrice: 10,
    })
  })

  it('clips the label and the key to their column widths', async () => {
    const store: Record<string, string> = {}
    await loadHandler(store)(
      printAdd({
        configuration: A3_GLOSSY.configuration,
        configurationKey: 'k'.repeat(80),
        configurationLabel: 'L'.repeat(600),
      })
    )
    const [line] = storedCart(store)
    expect(line.configurationKey).toBe('k'.repeat(64))
    expect(String(line.configurationLabel)).toHaveLength(500)
  })

  it('refuses, writing nothing, what the checkout would refuse', async () => {
    const tooLong = configured([{ key: 'message', value: 'x'.repeat(8100) }])
    for (const [add, message] of [
      [printAdd(tooLong), 'Your personalisation is too long. Please shorten it.'],
      [
        printAdd({ configuration: A3_GLOSSY.configuration, configurationKey: '' }),
        'Some of the options you chose are no longer available. Please review them.',
      ],
      [
        printAdd(A3_GLOSSY, { configurationPriceDelta: -5 }),
        'Some of the options you chose are no longer available. Please review them.',
      ],
      [
        printAdd(A3_GLOSSY, { configurationPriceDelta: 'NaN' }),
        'Some of the options you chose are no longer available. Please review them.',
      ],
    ] as Array<[Record<string, unknown>, string]>) {
      const store: Record<string, string> = {}
      expect(await loadHandler(store)(add)).toEqual({
        added: false,
        reason: 'options-invalid',
        message,
      })
      expect(store.workflow_cart).toBeUndefined()
    }
  })
})
