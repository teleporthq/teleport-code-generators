import { paymentChargeUser } from '../src/nodes/payment/payment-charge-user'
import { dataCreateItem } from '../src/nodes/data/data-create-item'

// Two regressions pinned in this file, both surfaced in a single
// guest-checkout attempt against the freshly generated project:
//
//   1) Clicking "Pay Now" with the Stripe payment method left the
//      button stuck at "Processing…". Root cause: the
//      payment-charge-user server handler returns
//      { checkoutUrl, sessionId, __terminal: true } and the client
//      runtime honors __terminal but does NOT navigate the buyer
//      to Stripe's hosted checkout page. The buyer never reaches
//      the payment form, the Stripe webhook never fires, and
//      isPlacingOrder is never reset back to "false".
//
//   2) No order-confirmation email was delivered. The
//      ecommerceSettings.orderNotificationConfig is wired into a
//      /api/ecommerce/order-notification endpoint, but the
//      endpoint was only called from the PayPal webhook —
//      COD orders and synchronous Stripe flows silently skipped
//      it. Auto-firing the notification from data-create-item on
//      every INSERT into teleport_orders covers BOTH paths
//      without requiring the AI to add an explicit email-send
//      workflow node.

describe('payment-charge-user emits __redirectUrl alongside __terminal', () => {
  const handlerSource = paymentChargeUser.generateHandler()

  it('Stripe path returns __redirectUrl set to the session URL', () => {
    // The exact JSON shape the workflow runtime consumes — we
    // assert on the source string because exercising the live
    // handler would require a real Stripe API key. ts-jest may
    // downlevel `const` to `var` in some configs, so match on the
    // assignment substring rather than the declaration keyword.
    expect(handlerSource).toContain('__redirectUrl: checkoutUrl')
    expect(handlerSource).toMatch(/checkoutUrl = session\.url/)
  })

  it('PayPal path returns __redirectUrl set to the PayPal approval link', () => {
    // Mirrors the Stripe wiring so both gateways drive the same
    // client-runtime redirect step. Without the PayPal half the
    // PayPal-only stores would hit the same stuck-Processing bug.
    expect(handlerSource).toContain('__redirectUrl: approveUrl')
    expect(handlerSource).toContain('approveUrl = approveLink ? approveLink.href')
  })

  it('still sets __terminal: true so the workflow stops at the redirect', () => {
    // The runtime stops on __terminal regardless of __redirectUrl;
    // both flags must be present so the redirect happens AND
    // downstream nodes (cart-clear, navigate-to-order-details,
    // reset-isPlacingOrder) are NOT executed before the buyer
    // leaves for Stripe — the cart should only clear on the
    // payment-success return URL.
    // The source uses object shorthand (`{ checkoutUrl, ... }`), so anchor on
    // the explicit __redirectUrl entry and assert __terminal sits in the same
    // return object.
    const anchor = handlerSource.indexOf('__redirectUrl: checkoutUrl')
    expect(anchor).toBeGreaterThan(-1)
    const stripeBlock = handlerSource.slice(Math.max(0, anchor - 300), anchor + 300)
    expect(stripeBlock).toContain('__terminal: true')
    expect(stripeBlock).toContain('__redirectUrl: checkoutUrl')
  })

  it('returns an error object (not __redirectUrl) when Stripe API call fails', () => {
    // The catch block must NOT add __redirectUrl — the client
    // runtime should render the toast/error path instead of
    // navigating to an empty URL on a failed charge. ts-jest may
    // rename `err` to `err_1` etc. during downleveling — match
    // the substring that proves the error message is surfaced.
    expect(handlerSource).toMatch(/error:\s*\w+\.message/)
  })
})

describe('data-create-item auto-fires order-notification for teleport_orders inserts', () => {
  const src = dataCreateItem.generateHandler() as string

  it('detects the teleport_orders table by name', () => {
    expect(src).toContain("tableName === 'teleport_orders'")
  })

  it('POSTs to /api/ecommerce/order-notification with the inserted row', () => {
    expect(src).toContain("'/api/ecommerce/order-notification'")
    // orderId is the raw UUID (used by support/debug); orderNumber is
    // the human-friendly identifier the merchant templates use. Older
    // code folded order_number into the orderId slot which made
    // {{orderNumber}} render as a UUID. We now pass both, with
    // orderNumber falling back to the id if no order_number column
    // exists.
    expect(src).toContain('orderId: item.id')
    expect(src).toContain('orderNumber: item.order_number || item.id')
    expect(src).toContain('customerEmail: item.billing_email')
    expect(src).toContain('customerName: item.billing_name')
    expect(src).toContain('paymentMethod: item.payment_method')
  })

  it('fires-and-forgets — does NOT await the notification call', () => {
    // Awaiting an email provider that times out would block the
    // workflow's success response back to the buyer, leaving the
    // checkout button stuck at Processing for the duration of the
    // provider's TCP timeout. Fire-and-forget is the right shape
    // here — failures are swallowed by .catch().
    expect(src).not.toMatch(/await\s+fetch\([^)]*order-notification/)
    expect(src).toContain('.catch(function')
  })

  it('only fires when the create succeeded with a row payload', () => {
    // A guarded block ensures we don't try to email out an empty
    // shell when handleCreate errored — that would surface a
    // confusing "Order # null" message to the merchant.
    expect(src).toMatch(/data && data\.item/)
  })

  it('does not touch the response shape the existing workflow consumes', () => {
    // The original return shape — { id, ...item } — must remain
    // identical so any downstream workflow node that reads
    // result.id keeps working. ts-jest's ES5 downleveling rewrites
    // the spread to __assign, so match the precise sub-fragments
    // rather than the full literal.
    expect(src).toMatch(
      /id:\s*data\.id\s*\|\|\s*\(data\.item\s*&&\s*data\.item\.id\)\s*\|\|\s*null/
    )
    // The item spread happens immediately after the id field; in
    // ES5 mode it surfaces as `__assign({ id: ... }, (data.item || {}))`.
    expect(src).toMatch(/\(data\.item\s*\|\|\s*\{\}\)/)
  })

  it('still forwards the anonymousUserId hint to the data-api', () => {
    // Sanity: the previous-session fix that fed anonymousUserId
    // through to coerceUuidColumnValue must not regress when
    // tacking the email-notification block onto the same handler.
    expect(src).toContain('reqBody.__anonymousUserId = __anonymousUserId')
  })
})
