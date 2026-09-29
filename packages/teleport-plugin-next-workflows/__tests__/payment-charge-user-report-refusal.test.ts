import { loadHandler } from './_helpers/load-handler'
import { PaymentDriverRegistry } from './_helpers/load-payment-drivers'

/**
 * `payment-charge-user` with `reportRefusal`: a provider that will not open
 * the checkout (keys refused, a currency its account cannot charge, a
 * business it has not verified) is answered as the node's result, so the
 * workflow can give back what the order held and tell the buyer why —
 * never under `error`, which would end the run.
 */

const registryOf = (driver: unknown): PaymentDriverRegistry => ({
  ids: ['coingate'],
  core: {},
  get: (id: string) => (id === 'coingate' ? driver : null),
})

const refusing = {
  createCheckout: async () => ({
    checkoutUrl: '',
    sessionId: '',
    error: 'Order is not valid: Business is not verified',
  }),
}
const opening = {
  createCheckout: async () => ({ checkoutUrl: 'https://pay.test/1', sessionId: '1234' }),
}

const CHARGE = {
  providerId: 'CoinGate',
  amount: 20,
  currency: 'eur',
  successUrl: '/order-details/ORD-1?payment=success',
  cancelUrl: '/order-details/ORD-1',
  metadata: '{"orderId":"order-1","orderNumber":"ORD-1"}',
  deferRedirect: true,
}
const CONTEXT = { __baseUrl: 'https://shop.test' }

const run = async (driver: unknown, config: Record<string, unknown>) =>
  (await loadHandler('payment-charge-user', { paymentDrivers: registryOf(driver) })(
    { ...CHARGE, ...config },
    CONTEXT
  )) as Record<string, unknown>

describe('payment-charge-user — reportRefusal', () => {
  beforeAll(() => {
    ;(globalThis as { __workflowUtils?: unknown }).__workflowUtils = {
      localizeHref: (href: string) => href,
    }
  })
  afterAll(() => {
    delete (globalThis as { __workflowUtils?: unknown }).__workflowUtils
  })

  it("answers the provider's refusal in its own words, for the workflow to act on", async () => {
    const result = await run(refusing, { reportRefusal: true })
    expect(result).toEqual({
      refused: 'true',
      refusal: 'Order is not valid: Business is not verified',
      provider: 'coingate',
      checkoutUrl: '',
      sessionId: '',
      attemptRef: '',
      attemptOutcome: '',
      redirectUrl: '',
    })
    expect(result).not.toHaveProperty('error')
  })

  it('says a provider the store has no driver for refused too', async () => {
    const result = await run(null, { reportRefusal: 'true' })
    expect(result).toMatchObject({
      refused: 'true',
      refusal: 'Payment provider "coingate" is not supported by this store.',
    })
  })

  it('names the provider and no refusal when the checkout opened', async () => {
    expect(await run(opening, { reportRefusal: true })).toEqual({
      checkoutUrl: 'https://pay.test/1',
      sessionId: '1234',
      attemptRef: '1234',
      attemptOutcome: 'created',
      redirectUrl: 'https://pay.test/1',
      refused: 'false',
      refusal: '',
      provider: 'coingate',
    })
  })

  it('still ends the run with a 400 without it', async () => {
    expect(await run(refusing, {})).toEqual({
      __earlyResponse: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: {
          success: false,
          error: 'Order is not valid: Business is not verified',
          provider: 'coingate',
        },
      },
    })
  })
})
