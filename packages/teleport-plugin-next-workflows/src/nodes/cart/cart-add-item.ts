import { CartCurrency } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'
import {
  COMMERCE_TRACKING_HELPER_SOURCE,
  assertHandlerHasNoModuleRefs,
} from '../analytics/commerce-tracking'

// AMBIENT, not imported. A cross-module call compiles to
// `(0, commerce_tracking_1.trackCommerceStep)(...)`, which survives
// `.toString()` and throws ReferenceError in the browser — the runtime has no
// module scope. Declaring the name emits nothing and leaves a bare identifier
// that the appended helper source defines. See `commerce-tracking.ts`.
declare function trackCommerceStep(step: { name: string; detail?: Record<string, unknown> }): void
// Same, for the cart-currency rule (`CartCurrency` in teleport-shared).
declare function __ccCurrencyRefusal(input: {
  lines: unknown[]
  currency: unknown
}): { added: false; reason: string; message: string } | null

async function cart_add_item(config: any) {
  const productId = config.productId
  const quantity = config.quantity || 1
  const variantId = config.variantId || null
  // Product details - stored alongside the product ID so the cart page can
  // display item name, image, and price without an extra data fetch.
  const name = config.name || null
  const price = config.price != null ? Number(config.price) : 0
  const image = config.image || null
  const currency = config.currency || null
  const currencySymbol = config.currencySymbol || config.currency_symbol || null
  const slug = config.slug || null
  // The per-product discount behind `price`, snapshotted onto the line so the
  // order can record what was given away. `price` is ALREADY the discounted net
  // price, so nothing here takes part in any total.
  const originalPrice = config.originalPrice != null ? Number(config.originalPrice) : null
  const discountType = config.discountType || null
  const discountValue = config.discountValue != null ? Number(config.discountValue) : null
  const discountAmount = config.discountAmount != null ? Number(config.discountAmount) : 0
  // What the discount engine prices the line by: its category ids INCLUDING
  // ancestors (`category_filter_ids`), and whether the product IS a gift card
  // — never discounted, and a cart holding one cannot be paid with one. The
  // workflow may hand either the parsed array or the raw JSON column, and a
  // config boolean arrives as the string 'true'; anything unreadable is
  // "no categories" / "not a gift card", never a thrown add-to-cart.
  let categoryIds: string[] = []
  try {
    let rawCategories = config.categoryIds
    if (typeof rawCategories === 'string' && rawCategories !== '') {
      rawCategories = JSON.parse(rawCategories)
    }
    if (Array.isArray(rawCategories)) {
      categoryIds = rawCategories
        .filter((entry: unknown) => entry !== null && entry !== undefined && entry !== '')
        .map((entry: unknown) => String(entry))
    }
  } catch {
    categoryIds = []
  }
  const readFlag = (value: unknown): boolean =>
    value === true ||
    value === 1 ||
    (typeof value === 'string' && ['true', 't', '1', 'yes'].indexOf(value.toLowerCase()) !== -1)
  const isGiftCard = readFlag(config.isGiftCard)
  // The line's kind, from the product row the workflow fetched: a subscription
  // is billed by the provider every interval and checks out alone at quantity
  // one; a gift card is issued by email once paid; a digital line is delivered
  // from the order page; anything else ships. One order holds ONE kind, so the
  // cart does too — a line of another kind is refused here, before anything is
  // written, and the workflow toasts why. One order is also charged in ONE
  // currency, so a line priced in another currency is refused the same way.
  const isRecurring = readFlag(config.isRecurring)
  const isDigital = readFlag(config.isDigital)
  const recurringInterval = isRecurring ? String(config.recurringInterval || 'month') : null
  const recurringIntervalCount = isRecurring
    ? Math.max(1, Math.floor(Number(config.recurringIntervalCount)) || 1)
    : null
  const trialDays = isRecurring ? Math.max(0, Math.floor(Number(config.trialDays)) || 0) : null
  const kindOf = (line: any): 'subscription' | 'gift-card' | 'digital' | 'physical' =>
    readFlag(line && line.isRecurring)
      ? 'subscription'
      : readFlag(line && line.isGiftCard)
      ? 'gift-card'
      : readFlag(line && line.isDigital)
      ? 'digital'
      : 'physical'
  const KIND_LABELS = {
    subscription: 'Subscriptions',
    'gift-card': 'Gift cards',
    digital: 'Digital products',
    physical: 'Physical products',
  }
  const lineKind = kindOf({ isRecurring, isGiftCard, isDigital })
  const refuse = (
    reason: 'mixed-cart' | 'mixed-currency' | 'one-subscription' | 'options-invalid',
    message: string
  ) => ({
    added: false,
    reason,
    message,
  })

  // The options the shopper chose, priced by the add-to-cart workflow:
  // `configuration` is the canonical JSON of the answers and `configurationKey`
  // its hash. A line is identified by product, variant AND configuration, so
  // two configurations of one product are two lines. `price` already includes
  // the options' surcharge (`configurationPriceDelta`, NET per unit) on top of
  // `basePrice`, the charged base, so every total downstream reads `price`
  // unchanged. A line without options carries none of these fields.
  const rawConfiguration = config.configuration
  const configuration = Array.isArray(rawConfiguration)
    ? rawConfiguration.length > 0
      ? JSON.stringify(rawConfiguration)
      : ''
    : typeof rawConfiguration === 'string'
    ? rawConfiguration.trim()
    : ''
  const configurationKey = configuration
    ? String(config.configurationKey == null ? '' : config.configurationKey)
        .trim()
        .slice(0, 64)
    : ''
  const configurationPriceDelta =
    config.configurationPriceDelta == null || config.configurationPriceDelta === ''
      ? 0
      : Number(config.configurationPriceDelta)
  // The same 8000-character cap the checkout enforces, so a line the checkout
  // would refuse never reaches the cart.
  if (configuration.length > 8000) {
    return refuse('options-invalid', 'Your personalisation is too long. Please shorten it.')
  }
  if (
    configuration &&
    (!configurationKey || !isFinite(configurationPriceDelta) || configurationPriceDelta < 0)
  ) {
    return refuse(
      'options-invalid',
      'Some of the options you chose are no longer available. Please review them.'
    )
  }
  const statedBasePrice =
    config.basePrice == null || config.basePrice === '' ? NaN : Number(config.basePrice)
  const lineOptions = configurationKey
    ? {
        configuration,
        configurationKey,
        configurationLabel: String(config.configurationLabel || '').slice(0, 500),
        configurationPriceDelta,
        basePrice: isFinite(statedBasePrice)
          ? statedBasePrice
          : Math.round((price - configurationPriceDelta) * 100) / 100,
      }
    : null

  // Per-product cap is published by `EcommerceProvider` to localStorage so
  // workflow handlers (which run outside React) can enforce the same limit
  // as the in-context `addToCart` / `updateItemQuantity` callbacks.
  let maxQty: number | null = null
  try {
    const settingsRaw = localStorage.getItem('workflow_cart_settings')
    if (settingsRaw) {
      const parsed = JSON.parse(settingsRaw)
      if (parsed && typeof parsed.maxQuantityPerProduct === 'number') {
        maxQty = parsed.maxQuantityPerProduct
      }
    }
  } catch {}

  try {
    const raw = localStorage.getItem('workflow_cart')
    const cart: any[] = raw ? JSON.parse(raw) : []

    // The key is a lookup hint, not an identity: a configured line is the same
    // line only when its configuration is identical too.
    const existingIndex = cart.findIndex(
      (item: any) =>
        item.productId === productId &&
        (item.variantId || null) === (variantId || null) &&
        String(item.configurationKey || '') === configurationKey &&
        (!configurationKey || item.configuration === configuration)
    )

    // A subscription already in the cart is the one unit it will ever be.
    if (existingIndex >= 0 && (isRecurring || kindOf(cart[existingIndex]) === 'subscription')) {
      return refuse(
        'one-subscription',
        'Subscriptions are checked out on their own. Finish or empty your current cart first.'
      )
    }
    const otherLines = cart.filter((_line: any, index: number) => index !== existingIndex)
    if (otherLines.length > 0) {
      if (isRecurring || kindOf(otherLines[0]) === 'subscription') {
        return refuse(
          'one-subscription',
          'Subscriptions are checked out on their own. Finish or empty your current cart first.'
        )
      }
      if (kindOf(otherLines[0]) !== lineKind) {
        return refuse(
          'mixed-cart',
          KIND_LABELS[lineKind] +
            ' need a separate order. Complete your current order or remove the other items from your cart first.'
        )
      }
      const currencyRefusal = __ccCurrencyRefusal({ lines: otherLines, currency })
      if (currencyRefusal) {
        return refuse('mixed-currency', currencyRefusal.message)
      }
    }

    if (existingIndex >= 0) {
      let nextQty = (Number(cart[existingIndex].quantity) || 0) + quantity
      if (maxQty !== null && nextQty > maxQty) {
        nextQty = maxQty
      }
      cart[existingIndex].quantity = nextQty
      // Update product details in case they changed
      if (name) {
        cart[existingIndex].name = name
      }
      if (price) {
        cart[existingIndex].price = price
      }
      if (image) {
        cart[existingIndex].image = image
      }
      if (currency) {
        cart[existingIndex].currency = currency
      }
      if (currencySymbol) {
        cart[existingIndex].currencySymbol = currencySymbol
      }
      if (slug) {
        cart[existingIndex].slug = slug
      }
      // Re-stamped unconditionally, unlike the fields above: a discount that has
      // just EXPIRED must clear the line's markdown, and `0` / `null` are the
      // values that say so — a truthiness guard would keep the stale saving.
      cart[existingIndex].originalPrice = originalPrice
      cart[existingIndex].discountType = discountType
      cart[existingIndex].discountValue = discountValue
      cart[existingIndex].discountAmount = discountAmount
      // Same rule: a product moved to another category, or turned into a gift
      // card, must re-price on the next add — the empty list and `false` are
      // the values that say "none".
      cart[existingIndex].categoryIds = categoryIds
      cart[existingIndex].isGiftCard = isGiftCard
      cart[existingIndex].isRecurring = isRecurring
      cart[existingIndex].recurringInterval = recurringInterval
      cart[existingIndex].recurringIntervalCount = recurringIntervalCount
      cart[existingIndex].trialDays = trialDays
      cart[existingIndex].isDigital = isDigital
      // The same answers can carry a new label or surcharge (an option renamed
      // or repriced since the line was added).
      if (lineOptions) {
        Object.assign(cart[existingIndex], lineOptions)
      }
      localStorage.setItem('workflow_cart', JSON.stringify(cart))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
      }
      // Reported AFTER the write succeeds, so the funnel counts carts that were
      // really changed rather than clicks that were merely attempted.
      trackCommerceStep({
        name: 'add_to_cart',
        detail: {
          currency,
          value: price * quantity,
          items: [{ item_id: productId, item_name: name, price, quantity }],
        },
      })
      const updated: any = {
        id: cart[existingIndex].id,
        productId,
        quantity: cart[existingIndex].quantity,
        added: true,
      }
      if (lineOptions) {
        updated.configurationKey = configurationKey
      }
      return updated
    } else {
      let initialQty = isRecurring ? 1 : quantity
      if (maxQty !== null && initialQty > maxQty) {
        initialQty = maxQty
      }
      const newItem: any = {
        id: 'cart_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        productId,
        variantId,
        quantity: initialQty,
        name,
        price,
        image,
        currency,
        currencySymbol,
        slug,
        originalPrice,
        discountType,
        discountValue,
        discountAmount,
        categoryIds,
        isGiftCard,
        isRecurring,
        recurringInterval,
        recurringIntervalCount,
        trialDays,
        isDigital,
      }
      if (lineOptions) {
        Object.assign(newItem, lineOptions)
      }
      cart.push(newItem)
      localStorage.setItem('workflow_cart', JSON.stringify(cart))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
      }
      trackCommerceStep({
        name: 'add_to_cart',
        detail: {
          currency,
          value: price * initialQty,
          items: [{ item_id: productId, item_name: name, price, quantity: initialQty }],
        },
      })
      const added: any = { id: newItem.id, productId, quantity: initialQty, added: true }
      if (lineOptions) {
        added.configurationKey = configurationKey
      }
      return added
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartAddItem: NodeHandlerGenerator = {
  nodeType: 'cart-add-item',
  executionEnv: 'client',
  generateHandler(): string {
    // The helpers are concatenated rather than imported: the handler ships as
    // a serialized function body with no module scope. They are string
    // literals rather than a `.toString()` so a consumer's minifier cannot
    // strip their declaration names. See `commerce-tracking.ts`.
    return assertHandlerHasNoModuleRefs(
      handlerToString(cart_add_item) +
        '\n' +
        COMMERCE_TRACKING_HELPER_SOURCE +
        '\n' +
        CartCurrency.generateCartCurrencyHelperCode(),
      'cart-add-item'
    )
  },
}
