import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generateDataAccessCode } from '../src/invoice/data-access-code'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

// Regression guards for the orderId-only payload path in /api/invoices/generate.
//
// Before the fix, the endpoint rejected any POST without `body.items`
// with HTTP 400 "At least one item is required". The `ecommerce-generate-invoice`
// workflow node only sends `{ orderId, sendEmail }` — so every webhook-driven
// invoice call hit the reject path and no invoice was ever created.
//
// The fix hydrates the request from `teleport_orders` + `teleport_order_items`
// when orderId is given. These tests lock in:
//
//   1. The data-access layer exposes a `getOrderWithItems` helper that
//      returns the order row + items array (or null when the order
//      doesn't exist).
//   2. The invoice route calls that helper when `body.orderId` is truthy.
//   3. The hydrated items flow into the `items` array when the caller
//      didn't provide any, but body.items still wins when explicitly
//      passed (future admin-side callers may want to override).
//   4. Customer/payment fields fall back to the order columns so the
//      rendered PDF has the buyer's name/address/payment info without
//      the caller rebuilding the payload.

// Minimal UIDLInvoiceSettings shape — the generators don't check
// fields we don't exercise here.
const FAKE_SETTINGS = {
  invoicePrefix: 'INV-',
  defaultTaxRate: 0,
  showDiscount: false,
  template: { document: null as unknown },
  tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
  emailDelivery: { enabled: false },
} as unknown as UIDLInvoiceSettings

describe('invoice data-access — getOrderWithItems', () => {
  it('is exported from the PostgreSQL data-access module', () => {
    const code = generateDataAccessCode(FAKE_SETTINGS, 'postgresql', null)
    expect(code).toContain('async function getOrderWithItems(orderId)')
    expect(code).toMatch(/SELECT \* FROM teleport_orders WHERE id = \$1 LIMIT 1/)
    expect(code).toMatch(
      /SELECT \* FROM teleport_order_items WHERE order_id = \$1 ORDER BY created_at ASC/
    )
    expect(code).toContain('getOrderWithItems: getOrderWithItems,')
  })

  it('returns null when the caller passes a falsy orderId', () => {
    // Defensive guard — the invoice route relies on this. Without it, the
    // downstream query would error with "invalid input syntax for type uuid".
    const code = generateDataAccessCode(FAKE_SETTINGS, 'postgresql', null)
    expect(code).toContain('if (!orderId) return null;')
  })

  it('generates MySQL + Supabase variants that also export getOrderWithItems', () => {
    const mysql = generateDataAccessCode(FAKE_SETTINGS, 'mysql', null)
    expect(mysql).toContain('async function getOrderWithItems(orderId)')
    expect(mysql).toContain("execute('SELECT * FROM teleport_orders WHERE id = ? LIMIT 1'")
    expect(mysql).toContain('getOrderWithItems: getOrderWithItems,')

    const supabase = generateDataAccessCode(FAKE_SETTINGS, 'supabase', null)
    expect(supabase).toContain('async function getOrderWithItems(orderId)')
    expect(supabase).toContain(".from('teleport_orders')")
    expect(supabase).toContain(".from('teleport_order_items')")
    expect(supabase).toContain('getOrderWithItems: getOrderWithItems,')
  })
})

describe('/api/invoices/generate — orderId hydration', () => {
  const route = generateInvoiceGenerateRouteCode(FAKE_SETTINGS)

  it('calls getOrderWithItems when body.orderId is provided', () => {
    // This is the ONLY thing that lets the webhook-driven invoice call
    // succeed — the workflow node sends {orderId, sendEmail} with no
    // items, and without the hydration call the endpoint's "at least
    // one item" guard rejects every payment webhook with HTTP 400.
    expect(route).toContain('if (body.orderId) {')
    expect(route).toContain('await dataAccess.getOrderWithItems(body.orderId)')
  })

  it('maps hydrated items from DB column names to invoice shape', () => {
    // `teleport_order_items` rows carry `product_name`, `unit_price`,
    // `total_price`. The invoice payload expects `name`, `unitPrice`,
    // `totalPrice`. Locking in the mapping prevents silent drift.
    expect(route).toContain("name: row.product_name || row.name || 'Item'")
    expect(route).toContain('unitPrice: Number(row.unit_price || row.unitPrice || row.price) || 0')
    expect(route).toContain('totalPrice: Number(row.total_price || row.totalPrice) || 0')
  })

  it('prefers body.items over hydrated items when both exist', () => {
    // Admin "regenerate invoice with custom items" use cases need
    // body.items to win. The condition checks length > 0 so an empty
    // explicit array still falls back to DB-hydrated items. The predicate is
    // named because the settle-wait below keys off it too — a caller that
    // brought its own lines never waits for the DB rows to land.
    expect(route).toContain(
      'var callerSuppliedItems = Array.isArray(body.items) && body.items.length > 0;'
    )
    expect(route).toContain('var items = callerSuppliedItems')
  })

  it('falls back to order.billing_* / shipping_* fields for customer data', () => {
    // teleport_orders carries billing_name/email/address for the buyer
    // plus shipping_name/city/state/zip/country for the recipient. The
    // invoice fields mirror this — we use billing fields primarily and
    // fall back to shipping when billing is unset (matches "bill to
    // different address" checkout path where only shipping is filled).
    expect(route).toContain(
      'orderRow.billing_name || orderRow.shipping_name || orderRow.customer_name'
    )
    expect(route).toContain('orderRow.billing_email || orderRow.customer_email')
    expect(route).toContain('orderRow.billing_address || orderRow.shipping_address')
    expect(route).toContain('orderRow.shipping_city')
    expect(route).toContain('orderRow.payment_method')
    expect(route).toContain('orderRow.payment_provider')
    expect(route).toContain('orderRow.payment_intent_id')
  })

  it('uses the hydrated order.currency when body.currency is absent', () => {
    // Same currency the buyer checked out with — otherwise an invoice
    // generated from an EUR order would render as USD (the default).
    expect(route).toContain(
      'body.currency || (hydratedOrder && hydratedOrder.currency) || DEFAULT_CURRENCY'
    )
  })

  it('isolates hydration failures so they never break the request', () => {
    // If the DB query itself throws, we log and proceed with the
    // caller-provided payload — any explicit body.items still works.
    // Locking in the try/catch prevents a future refactor from
    // surfacing DB errors to Stripe/PayPal as 5xx responses (which
    // would trigger infinite webhook retries).
    expect(route).toMatch(/try\s*\{[\s\S]*?await dataAccess\.getOrderWithItems/m)
    expect(route).toContain('Invoice generation: order hydration failed')
  })
})
