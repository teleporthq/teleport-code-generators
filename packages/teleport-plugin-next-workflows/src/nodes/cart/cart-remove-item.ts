import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_remove_item(config: any) {
  const itemId = config.itemId

  try {
    const raw = localStorage.getItem('workflow_cart')
    const cart: any[] = raw ? JSON.parse(raw) : []
    const newCart = cart.filter((item: any) => item.id !== itemId)

    localStorage.setItem('workflow_cart', JSON.stringify(newCart))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
    }
    return { success: true, cart: newCart }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartRemoveItem: NodeHandlerGenerator = {
  nodeType: 'cart-remove-item',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_remove_item)
  },
}
