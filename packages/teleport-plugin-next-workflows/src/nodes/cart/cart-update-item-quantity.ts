import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_update_item_quantity(config: any) {
  const itemId = config.itemId
  const amount = Number(config.quantity) || 1
  const updateMode = config.updateMode || 'set'

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
    let newQuantity = 0

    for (let i = 0; i < cart.length; i++) {
      if (cart[i].id === itemId) {
        if (updateMode === 'increment') {
          newQuantity = (Number(cart[i].quantity) || 0) + amount
        } else if (updateMode === 'decrement') {
          newQuantity = (Number(cart[i].quantity) || 0) - amount
        } else {
          newQuantity = amount
        }
        // Clamp on increase paths only — `decrement` can only lower quantity,
        // so it never needs the cap.
        if (updateMode !== 'decrement' && maxQty !== null && newQuantity > maxQty) {
          newQuantity = maxQty
        }
        // A subscription is ONE unit: the provider bills the plan, not a
        // quantity. The stepper is hidden for such a line, but a hand-fired
        // increment must not turn it into two plans either.
        const isRecurring = cart[i].isRecurring === true || cart[i].isRecurring === 'true'
        if (isRecurring && newQuantity > 1) {
          newQuantity = 1
        }
        if (newQuantity <= 0) {
          cart.splice(i, 1)
          newQuantity = 0
        } else {
          cart[i].quantity = newQuantity
        }
        break
      }
    }

    localStorage.setItem('workflow_cart', JSON.stringify(cart))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
    }
    return { id: itemId, quantity: newQuantity }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartUpdateItemQuantity: NodeHandlerGenerator = {
  nodeType: 'cart-update-item-quantity',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_update_item_quantity)
  },
}
