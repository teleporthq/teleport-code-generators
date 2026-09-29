/* tslint:disable:function-constructor */
import { cartAddItem } from '../src/nodes/cart/cart-add-item'

/**
 * One order holds ONE kind of line — a subscription (billed by the provider,
 * alone, quantity one), digital goods (delivered from the order page) or
 * physical goods (shipped) — so the cart does too. `cart-add-item` refuses a
 * line of another kind BEFORE anything is written and says which kind needs
 * its own order; the workflow toasts that message. A storefront line written
 * before the flags existed reads as physical.
 */

interface AddToCartResult {
  added: boolean
  reason?: string
  message?: string
  quantity?: number
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

const withCart = (lines: Array<Record<string, unknown>>): Record<string, string> => ({
  workflow_cart: JSON.stringify(lines),
})

afterEach(() => {
  delete (global as any).localStorage
  delete (global as any).window
  delete (global as any).CustomEvent
})

describe('cart-add-item — one kind of line per cart', () => {
  it('answers added: true for a line that joins an empty cart, carrying its kind', async () => {
    const store: Record<string, string> = {}
    const result = await loadHandler(store)({
      productId: 'sub',
      quantity: 3,
      price: 24,
      isRecurring: 'true',
      recurringInterval: 'month',
      recurringIntervalCount: '3',
      trialDays: '14',
    })
    expect(result).toMatchObject({ added: true, quantity: 1 })
    expect(storedCart(store)[0]).toMatchObject({
      isRecurring: true,
      recurringInterval: 'month',
      recurringIntervalCount: 3,
      trialDays: 14,
      isDigital: false,
      quantity: 1,
    })
  })

  it('refuses a digital line beside a physical one, naming the digital kind', async () => {
    const store = withCart([{ id: 'c1', productId: 'mug', quantity: 1, price: 12 }])
    const result = await loadHandler(store)({ productId: 'ebook', price: 9, isDigital: true })
    expect(result).toEqual({
      added: false,
      reason: 'mixed-cart',
      message:
        'Digital products need a separate order. Complete your current order or remove the other items from your cart first.',
    })
    expect(storedCart(store)).toHaveLength(1)
  })

  it('refuses a physical line beside a digital one, naming the physical kind', async () => {
    const store = withCart([
      { id: 'c1', productId: 'ebook', quantity: 1, price: 9, isDigital: true },
    ])
    const result = await loadHandler(store)({ productId: 'mug', price: 12 })
    expect(result).toMatchObject({ added: false, reason: 'mixed-cart' })
    expect(result.message).toMatch(/^Physical products need a separate order\./)
    expect(storedCart(store)).toHaveLength(1)
  })

  it('refuses a subscription beside anything, and anything beside a subscription', async () => {
    const besidePhysical = withCart([{ id: 'c1', productId: 'mug', quantity: 1, price: 12 }])
    expect(
      await loadHandler(besidePhysical)({ productId: 'plan', price: 24, isRecurring: 'true' })
    ).toEqual({
      added: false,
      reason: 'one-subscription',
      message:
        'Subscriptions are checked out on their own. Finish or empty your current cart first.',
    })
    const besideSubscription = withCart([
      { id: 'c1', productId: 'plan', quantity: 1, price: 24, isRecurring: 'true' },
    ])
    expect(
      await loadHandler(besideSubscription)({ productId: 'ebook', price: 9, isDigital: 't' })
    ).toMatchObject({
      added: false,
      reason: 'one-subscription',
    })
  })

  it('keeps a gift card on its own: it joins no other kind, and no other kind joins it', async () => {
    const besidePhysical = withCart([{ id: 'c1', productId: 'mug', quantity: 1, price: 12 }])
    expect(
      await loadHandler(besidePhysical)({ productId: 'card', price: 50, isGiftCard: 'true' })
    ).toEqual({
      added: false,
      reason: 'mixed-cart',
      message:
        'Gift cards need a separate order. Complete your current order or remove the other items from your cart first.',
    })
    const besideDigital = withCart([
      { id: 'c1', productId: 'ebook', quantity: 1, price: 9, isDigital: true },
    ])
    expect(
      await loadHandler(besideDigital)({ productId: 'card', price: 50, isGiftCard: true })
    ).toMatchObject({ added: false, reason: 'mixed-cart' })
    const besideCard = withCart([
      { id: 'c1', productId: 'card', quantity: 1, price: 50, isGiftCard: true },
    ])
    expect(
      await loadHandler(besideCard)({ productId: 'ebook', price: 9, isDigital: true })
    ).toMatchObject({
      added: false,
      reason: 'mixed-cart',
      message: expect.stringMatching(/^Digital products need a separate order\./),
    })
    const secondCard = await loadHandler(besideCard)({
      productId: 'card-100',
      price: 100,
      isGiftCard: true,
    })
    expect(secondCard).toMatchObject({ added: true })
    expect(storedCart(besideCard).map((line) => line.isGiftCard)).toEqual([true, true])
  })

  it('never turns the one subscription in the cart into two units', async () => {
    const store = withCart([
      { id: 'c1', productId: 'plan', quantity: 1, price: 24, isRecurring: true },
    ])
    const result = await loadHandler(store)({ productId: 'plan', price: 24, isRecurring: true })
    expect(result).toMatchObject({ added: false, reason: 'one-subscription' })
    expect(storedCart(store)[0].quantity).toBe(1)
  })

  it('refuses the same subscription again with other options: another configuration is another line', async () => {
    const store = withCart([
      {
        id: 'c1',
        productId: 'plan',
        quantity: 1,
        price: 24,
        isRecurring: true,
        configuration: '[{"key":"roast","value":"dark"}]',
        configurationKey: 'aaaaaaaaaaaaaaaa',
      },
    ])
    const result = await loadHandler(store)({
      productId: 'plan',
      price: 24,
      isRecurring: true,
      configuration: '[{"key":"roast","value":"light"}]',
      configurationKey: 'bbbbbbbbbbbbbbbb',
    })
    expect(result).toEqual({
      added: false,
      reason: 'one-subscription',
      message:
        'Subscriptions are checked out on their own. Finish or empty your current cart first.',
    })
    expect(storedCart(store)).toHaveLength(1)
  })

  it('lets a line of the same kind join, and re-stamps the kind on an existing line', async () => {
    const store = withCart([
      { id: 'c1', productId: 'ebook', quantity: 1, price: 9, isDigital: true },
    ])
    const joined = await loadHandler(store)({ productId: 'preset', price: 19, isDigital: 'yes' })
    expect(joined).toMatchObject({ added: true })
    const bumped = await loadHandler(store)({
      productId: 'ebook',
      quantity: 1,
      price: 9,
      isDigital: true,
    })
    expect(bumped).toMatchObject({ added: true, quantity: 2 })
    expect(storedCart(store).map((line) => line.isDigital)).toEqual([true, true])
  })
})

describe('cart-add-item — one currency per cart', () => {
  it('refuses a line priced in another currency, naming both, and writes nothing', async () => {
    const store = withCart([
      { id: 'c1', productId: 'mug', quantity: 1, price: 12, currency: 'USD' },
    ])
    const result = await loadHandler(store)({ productId: 'tea', price: 19.99, currency: 'ron' })
    expect(result).toEqual({
      added: false,
      reason: 'mixed-currency',
      message:
        'Products priced in RON need a separate order. Complete your current order or remove the items priced in USD from your cart first.',
    })
    expect(storedCart(store)).toHaveLength(1)
  })

  it('judges the kind first', async () => {
    const store = withCart([
      { id: 'c1', productId: 'mug', quantity: 1, price: 12, currency: 'USD' },
    ])
    const result = await loadHandler(store)({
      productId: 'ebook',
      isDigital: true,
      currency: 'EUR',
    })
    expect(result).toMatchObject({ added: false, reason: 'mixed-cart' })
  })

  it('lets a line of the same currency join, and a re-added line change its own', async () => {
    const store = withCart([
      { id: 'c1', productId: 'mug', quantity: 1, price: 12, currency: 'usd' },
    ])
    const joined = await loadHandler(store)({ productId: 'tea', price: 5, currency: 'USD' })
    expect(joined).toMatchObject({ added: true })
    // The only line: nothing else to be priced against.
    const alone = withCart([
      { id: 'c1', productId: 'mug', quantity: 1, price: 12, currency: 'USD' },
    ])
    const bumped = await loadHandler(alone)({ productId: 'mug', price: 12, currency: 'EUR' })
    expect(bumped).toMatchObject({ added: true, quantity: 2 })
    expect(storedCart(alone)[0]).toMatchObject({ currency: 'EUR' })
  })

  it('does not judge a line, or a cart, that names no currency', async () => {
    const legacy = withCart([{ id: 'c1', productId: 'mug', quantity: 1, price: 12 }])
    expect(
      await loadHandler(legacy)({ productId: 'tea', price: 5, currency: 'RON' })
    ).toMatchObject({ added: true })
    const priced = withCart([
      { id: 'c1', productId: 'mug', quantity: 1, price: 12, currency: 'USD' },
    ])
    expect(await loadHandler(priced)({ productId: 'tea', price: 5 })).toMatchObject({
      added: true,
    })
  })
})
