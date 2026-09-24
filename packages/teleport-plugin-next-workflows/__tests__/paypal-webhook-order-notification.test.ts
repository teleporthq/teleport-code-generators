import { generatePaypalWebhookCode } from '../src/webhook-generator'
import type { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * The PayPal webhook tells the order-notification route which order was paid.
 * The capture resource's own id is a PayPal id — it matches no `teleport_orders`
 * row, so a notification keyed on it reached the merchant with no lines at all.
 * The internal id travels in `custom_id`, and the helper that reads it must be
 * emitted whenever notifications are on, not only when invoices are.
 */
const ecommerce = (orderNotifications: boolean): UIDLEcommerceSettings =>
  ({ orderNotifications } as unknown as UIDLEcommerceSettings)

const invoices = (enabled: boolean): UIDLInvoiceSettings =>
  ({ enabled, autoGenerateOnPayment: enabled } as unknown as UIDLInvoiceSettings)

describe('PayPal webhook — order notification order id', () => {
  it('sends the internal order id, falling back to the capture id', () => {
    const source = generatePaypalWebhookCode(invoices(false), ecommerce(true))
    expect(source).toContain("orderId: __extractInternalOrderId(resource) || resource.id || ''")
    expect(source).toContain('function __extractInternalOrderId(resource)')
    // Invoices are off: their handler is not emitted, only the id helper both share.
    expect(source).not.toContain('async function handlePaypalInvoiceGeneration')
  })

  it('emits the helper for invoices alone too, and both handlers when both are on', () => {
    const invoicesOnly = generatePaypalWebhookCode(invoices(true), ecommerce(false))
    expect(invoicesOnly).toContain('function __extractInternalOrderId(resource)')
    expect(invoicesOnly).toContain('async function handlePaypalInvoiceGeneration')
    expect(invoicesOnly).not.toContain('/api/ecommerce/order-notification')

    const both = generatePaypalWebhookCode(invoices(true), ecommerce(true))
    expect(both.match(/function __extractInternalOrderId\(resource\)/g)).toHaveLength(1)
    expect(both).toContain('/api/ecommerce/order-notification')
  })

  it('emits neither when neither feature is on', () => {
    const source = generatePaypalWebhookCode(invoices(false), ecommerce(false))
    expect(source).not.toContain('__extractInternalOrderId')
  })
})
