import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_clear() {
  try {
    localStorage.setItem('workflow_cart', JSON.stringify([]))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('teleport:cart-changed'))
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const cartClear: NodeHandlerGenerator = {
  nodeType: 'cart-clear',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_clear)
  },
}
