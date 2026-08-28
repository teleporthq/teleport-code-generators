/* tslint:disable:no-eval */
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

/**
 * A delivery fee may only be charged for an order the store actually DELIVERS.
 *
 * `deliveryPrice` survives in the settings after a merchant switches to
 * pickup-only — nothing clears it — so the flag has to gate the RATE and not
 * merely hide the row. These lock in the two halves the provider owns:
 *
 *   1. `computeShippingMeta` quotes 0 when the store does not deliver.
 *   2. The `workflow_cart_settings` snapshot carries `deliveryEnabled` /
 *      `storePickupEnabled`, which is the only channel by which the
 *      standalone `cart-get-total` handler — and through it the place-order
 *      assemble script — can learn either fact at runtime.
 *
 * Mirrors `resolveCartDelivery` in the editor (teleport-gui
 * `features/e-commerce/utils/delivery-fee.ts`), which is what the cart
 * simulator and the canvas projection price with.
 */

const baseSettings = (overrides: Partial<UIDLEcommerceSettings>): UIDLEcommerceSettings =>
  ({
    cashOnDelivery: true,
    deliveryEnabled: true,
    storePickupEnabled: false,
    guestCheckout: true,
    stockManagement: false,
    orderNotifications: false,
    deliveryConfig: {
      deliveryPrice: 10,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
      allowDeliveryNotes: true,
    },
    stockManagementConfig: null,
    orderNotificationConfig: null,
    paymentProviders: [],
    ...overrides,
  } as any)

interface ShippingMeta {
  shippingIsFree: boolean
  shippingPrice: number
  totalWithShipping: number
  freeDeliveryProgress: string
  freeDeliveryRemaining: number
}

/**
 * Lifts `computeShippingMeta` (and the `roundMoney` it depends on) out of the
 * emitted provider and makes it callable, so these run the arithmetic that
 * ships rather than matching substrings of it.
 */
function evalShippingMath(
  source: string
): (
  cartTotal: number,
  deliveryConfig: Record<string, unknown> | null,
  deliveryEnabled: boolean
) => ShippingMeta {
  const grab = (name: string): string => {
    const start = source.indexOf(`function ${name}(`)
    if (start === -1) {
      throw new Error(`emitted provider is missing function ${name}`)
    }
    // Helpers are top-level, so their closing brace is the first one at column 0.
    const end = source.indexOf('\n}', start)
    return source.slice(start, end + 2)
  }
  // tslint:disable-next-line:function-constructor
  return new Function(
    [grab('roundMoney'), grab('computeShippingMeta'), 'return computeShippingMeta'].join('\n')
  )()
}

/** The `deliveryConfig` literal the provider writes into `workflow_cart_settings`. */
function readPersistedDeliveryConfig(source: string): Record<string, unknown> {
  const match = source.match(/deliveryConfig: (\{[^}]*\}),/)
  if (!match) {
    throw new Error('emitted provider does not persist a deliveryConfig snapshot')
  }
  return JSON.parse(match[1])
}

describe('EcommerceProvider — delivery fee is gated on the store delivering', () => {
  it('quotes the configured rate for a store that delivers', () => {
    const computeShippingMeta = evalShippingMath(
      generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    )
    const meta = computeShippingMeta(200, { deliveryPrice: 10 }, true)

    expect(meta.shippingPrice).toBe(10)
    expect(meta.totalWithShipping).toBe(210)
  })

  it('quotes nothing for a pickup-only store, however stale its saved rate', () => {
    const computeShippingMeta = evalShippingMath(
      generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    )
    const meta = computeShippingMeta(200, { deliveryPrice: 10 }, false)

    expect(meta.shippingPrice).toBe(0)
    expect(meta.totalWithShipping).toBe(200)
  })

  it('still waives the fee at the free-delivery threshold', () => {
    const computeShippingMeta = evalShippingMath(
      generateEcommerceContextFileContent(baseSettings({}), undefined, 'ds-1')
    )
    const meta = computeShippingMeta(
      200,
      { deliveryPrice: 10, freeDeliveryEnabled: true, freeDeliveryThreshold: 150 },
      true
    )

    expect(meta.shippingIsFree).toBe(true)
    expect(meta.shippingPrice).toBe(0)
    expect(meta.freeDeliveryRemaining).toBe(0)
  })
})

describe('EcommerceProvider — workflow_cart_settings snapshot', () => {
  it('carries the fulfilment flags the standalone cart handlers cannot otherwise see', () => {
    const out = generateEcommerceContextFileContent(
      baseSettings({ deliveryEnabled: false, storePickupEnabled: true }),
      undefined,
      'ds-1'
    )

    expect(readPersistedDeliveryConfig(out)).toEqual({
      deliveryEnabled: false,
      storePickupEnabled: true,
      deliveryPrice: 10,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
    })
  })

  it('reads a missing delivery config as a zero rate rather than dropping the flags', () => {
    const out = generateEcommerceContextFileContent(
      baseSettings({ deliveryConfig: null as any }),
      undefined,
      'ds-1'
    )

    expect(readPersistedDeliveryConfig(out)).toEqual({
      deliveryEnabled: true,
      storePickupEnabled: false,
      deliveryPrice: 0,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
    })
  })
})
