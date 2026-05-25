import { NodeHandlerGenerator, handlerToString } from '../types'

async function cart_get_total() {
  try {
    const raw = localStorage.getItem('workflow_cart')
    const cart: any[] = raw ? JSON.parse(raw) : []
    let total = 0
    let itemCount = 0

    for (const item of cart) {
      const qty = item.quantity || 1
      const price = item.price || 0
      total += qty * price
      itemCount += qty
    }

    const rounded = Math.round(total * 100) / 100

    // Surface the runtime delivery config alongside the totals so the
    // place-order workflow's assemble script can compute shipping from
    // CURRENT settings instead of values baked at workflow-build time.
    // Without this, changing `Settings → Delivery → deliveryPrice` in the
    // GUI updates the cart UI immediately (it reads
    // `ecommerce.Settings.Delivery.deliveryPrice` at render) but the order
    // INSERT keeps charging the old baked value until the buyer re-exports
    // their UIDL. Mirroring the config here lets the workflow stay in sync
    // without an export round-trip.
    let deliveryConfig: {
      deliveryPrice: number
      freeDeliveryEnabled: boolean
      freeDeliveryThreshold: number
    } | null = null
    try {
      const settingsRaw = localStorage.getItem('workflow_cart_settings')
      if (settingsRaw) {
        const parsed = JSON.parse(settingsRaw)
        if (parsed && typeof parsed === 'object' && parsed.deliveryConfig) {
          deliveryConfig = {
            deliveryPrice: Number(parsed.deliveryConfig.deliveryPrice) || 0,
            freeDeliveryEnabled: !!parsed.deliveryConfig.freeDeliveryEnabled,
            freeDeliveryThreshold: Number(parsed.deliveryConfig.freeDeliveryThreshold) || 0,
          }
        }
      }
    } catch (_settingsErr) {
      /* ignore — fall back to absent deliveryConfig */
    }

    return {
      subtotal: rounded,
      tax: 0,
      total: rounded,
      itemCount,
      deliveryConfig,
    }
  } catch (_err) {
    return { subtotal: 0, tax: 0, total: 0, itemCount: 0, deliveryConfig: null }
  }
}
export const cartGetTotal: NodeHandlerGenerator = {
  nodeType: 'cart-get-total',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(cart_get_total)
  },
}
