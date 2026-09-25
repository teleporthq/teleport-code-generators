/* tslint:disable:function-constructor */
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
