import { NodeHandlerGenerator, handlerToString } from '../types'

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

    const existingIndex = cart.findIndex(
      (item: any) =>
        item.productId === productId && (item.variantId || null) === (variantId || null)
    )

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
      localStorage.setItem('workflow_cart', JSON.stringify(cart))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
      }
      return {
        id: cart[existingIndex].id,
        productId,
        quantity: cart[existingIndex].quantity,
      }
    } else {
      let initialQty = quantity
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
      }
      cart.push(newItem)
      localStorage.setItem('workflow_cart', JSON.stringify(cart))
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
      }
      return { id: newItem.id, productId, quantity: initialQty }
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartAddItem: NodeHandlerGenerator = {
  nodeType: 'cart-add-item',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_add_item)
  },
}
