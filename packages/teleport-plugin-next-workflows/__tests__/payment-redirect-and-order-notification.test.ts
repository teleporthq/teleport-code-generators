import { loadHandler } from './_helpers/load-handler'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { createFakeStripe } from './_helpers/fake-stripe'
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
  const localizeHref = { localizeHref: (href: string) => href }
  beforeAll(() => {
    ;(globalThis as { __workflowUtils?: unknown }).__workflowUtils = localizeHref
  })
  afterAll(() => {
    delete (globalThis as { __workflowUtils?: unknown }).__workflowUtils
  })

  const withEnv = async <T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> => {
    const saved = Object.keys(env).map((key) => [key, process.env[key]] as const)
    Object.assign(process.env, env)
    try {
      return await run()
    } finally {
      saved.forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      })
    }
  }

  it('Stripe path returns __redirectUrl set to the session URL, with __terminal', async () => {
    const { FakeStripe } = createFakeStripe({
      'checkout.sessions.create': () => ({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' }),
    })
    const handler = loadHandler('payment-charge-user', {
      paymentDrivers: loadPaymentDrivers({ stripe: FakeStripe }),
    })
    const result = await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1' }, () =>
      handler({ providerId: 'stripe', amount: 10, currency: 'usd' }, {})
    )
    // The runtime stops on __terminal and navigates on __redirectUrl: both
    // must be present, or the buyer is stuck on "Processing…" or the cart
    // clears before they pay.
    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.com/c/cs_1',
      sessionId: 'cs_1',
      attemptRef: 'cs_1',
      attemptOutcome: 'created',
      redirectUrl: 'https://checkout.stripe.com/c/cs_1',
      __terminal: true,
      __redirectUrl: 'https://checkout.stripe.com/c/cs_1',
    })
  })

  it('PayPal path returns __redirectUrl set to the PayPal approval link', async () => {
    const previous = (globalThis as { fetch?: unknown }).fetch
    ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith('/v1/oauth2/token')
          ? { access_token: 'token' }
          : { id: 'ORDER-1', links: [{ rel: 'approve', href: 'https://paypal.test/approve' }] },
    })
    try {
      const result = await withEnv(
        { PAYPAL_CLIENT_ID: 'Aclient', PAYPAL_CLIENT_SECRET: 'Esecret' },
        () =>
          loadHandler('payment-charge-user')(
            { providerId: 'paypal', amount: 10, currency: 'usd' },
            {}
          )
      )
      expect(result).toEqual({
        checkoutUrl: 'https://paypal.test/approve',
        sessionId: 'ORDER-1',
        attemptRef: 'ORDER-1',
        attemptOutcome: 'created',
        redirectUrl: 'https://paypal.test/approve',
        __terminal: true,
        __redirectUrl: 'https://paypal.test/approve',
      })
    } finally {
      ;(globalThis as { fetch?: unknown }).fetch = previous
      ;(globalThis as { __paypalBaseUrlCache?: string }).__paypalBaseUrlCache = undefined
    }
  })

  it('answers a failed provider call with an early 400, never a redirect to an empty URL', async () => {
    const { FakeStripe } = createFakeStripe({
      'checkout.sessions.create': () => {
        throw new Error('Invalid API Key provided')
      },
    })
    const handler = loadHandler('payment-charge-user', {
      paymentDrivers: loadPaymentDrivers({ stripe: FakeStripe }),
    })
    const result = await withEnv({ STRIPE_SECRET_KEY: 'sk_test_1' }, () =>
      handler({ providerId: 'stripe', amount: 10, currency: 'usd' }, {})
    )
    expect(result).toEqual({
      __earlyResponse: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { success: false, error: 'Invalid API Key provided', provider: 'stripe' },
      },
    })
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

  it("sends the order's tax breakdown and each line's product ids, so the route prices lines at their rate", () => {
    expect(src).toContain('taxBreakdown: item.tax_breakdown || null')
    expect(src).toContain("product_id: it.productId || it.product_id || ''")
    expect(src).toContain("variant_id: it.variantId || it.variant_id || ''")
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
