import { generatePaypalWebhookCode, generateStripeWebhookCode } from '../src/webhook-generator'
import { FetchCall, withEnv, withFetch } from './_helpers/fake-fetch'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'

/**
 * The legacy `/api/webhooks/stripe` and `/api/webhooks/paypal` routes call the
 * store's own `/api/invoices/generate` and `/api/ecommerce/order-notification`.
 * Both now serve only the store's server code, so the calls present the app
 * secret — and, carrying it, go to the store's own origin (the trustedBaseUrl
 * rule), never to the host a request named. EXECUTED under a hostile Host.
 */

const APP_SECRET = 'app-secret'
const STORE_ORIGIN = 'https://shop.example'

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_1',
  PAYPAL_CLIENT_ID: 'client',
  PAYPAL_CLIENT_SECRET: 'secret',
  NEXTAUTH_SECRET: APP_SECRET,
  NEXTAUTH_URL: STORE_ORIGIN,
  TELEPORT_DB_CONNECTION_STRING: 'postgres://store',
}

// A pg whose order read answers `order`, and whose writes succeed.
const scriptedPg = (order: Record<string, unknown>) => {
  function Client(): Record<string, unknown> {
    return {
      connect: async (): Promise<void> => undefined,
      query: async (text: string) =>
        /^SELECT/.test(text) ? { rows: [order] } : { rowCount: 1, rows: [] },
      end: async (): Promise<void> => undefined,
    }
  }
  return { Client }
}

const deliver = async (
  source: string,
  event: unknown,
  host: string,
  order: Record<string, unknown> = {},
  env: Record<string, string> = {}
): Promise<FetchCall[]> => {
  const requireShim = (id: string) => {
    if (id === 'pg') {
      return scriptedPg(order)
    }
    if (id.endsWith('/utils/payments')) {
      return {
        get: () => ({ verifyWebhook: async () => ({ ok: true, body: event }) }),
        core: loadPaymentDrivers({ ids: ['stripe'] }).core,
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, {}, requireShim)
  return withEnv({ ...ENV, ...env }, () =>
    withFetch(
      () => ({ status: 200, body: { invoiceId: 'inv-1', invoiceNumber: 'INV-0001' } }),
      async (calls) => {
        await module.exports(
          {
            method: 'POST',
            headers: { host, 'stripe-signature': 't=1,v1=x' },
            body: Buffer.from('{}'),
          },
          {
            status: () => ({ json: () => undefined }),
          }
        )
        return calls.slice()
      }
    )
  )
}

const selfCalls = (calls: FetchCall[]) =>
  calls.filter((call) =>
    /\/api\/(invoices\/generate|ecommerce\/order-notification)$/.test(call.url)
  )

const expectStoreCalls = (calls: FetchCall[], paths: string[]) => {
  const own = selfCalls(calls)
  expect(own.map((call) => call.url).sort()).toEqual(
    paths.map((path) => STORE_ORIGIN + path).sort()
  )
  for (const call of own) {
    expect(call.headers['x-internal-data-secret']).toBe(APP_SECRET)
  }
  expect(calls.some((call) => call.url.indexOf('evil.test') !== -1)).toBe(false)
}

describe('legacy webhook self-calls: the secret, to the store only', () => {
  const invoices: any = { enabled: true, autoGenerateOnPayment: true }
  const notifications: any = { orderNotifications: true }

  it('Stripe: a paid checkout is invoiced and announced on the store origin, with the secret', async () => {
    const calls = await deliver(
      generateStripeWebhookCode(invoices, notifications),
      {
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_1',
            payment_status: 'paid',
            payment_intent: 'pi_1',
            amount_total: 1000,
            currency: 'usd',
            metadata: { orderId: 'order-1' },
          },
        },
      },
      'evil.test'
    )
    expectStoreCalls(calls, ['/api/invoices/generate', '/api/ecommerce/order-notification'])
  })

  it('Stripe: a paid subscription invoice is invoiced on the store origin, with the secret', async () => {
    const calls = await deliver(
      generateStripeWebhookCode(invoices, undefined),
      {
        id: 'evt_2',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_1',
            customer_email: 'buyer@example.com',
            amount_paid: 1000,
            currency: 'usd',
            lines: { data: [{ description: 'Plan', amount: 1000, quantity: 1 }] },
          },
        },
      },
      'evil.test'
    )
    expectStoreCalls(calls, ['/api/invoices/generate'])
  })

  it('PayPal: a completed capture is invoiced and announced on the store origin, with the secret', async () => {
    const calls = await deliver(
      generatePaypalWebhookCode(invoices, notifications),
      {
        id: 'WH-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: 'CAP-1',
          status: 'COMPLETED',
          amount: { value: '30.00', currency_code: 'USD' },
          custom_id: JSON.stringify({ orderId: 'order-1', orderNumber: 'ORD-1' }),
        },
      },
      'evil.test',
      { status: 'pending', payment_status: 'unpaid', currency: 'USD', total_amount: '30.00' }
    )
    expectStoreCalls(calls, ['/api/invoices/generate', '/api/ecommerce/order-notification'])
  })

  it("keeps Vercel's routed host, and a local dev server's own port", async () => {
    const source = generateStripeWebhookCode(invoices, undefined)
    const event = {
      id: 'evt_3',
      type: 'invoice.payment_succeeded',
      data: { object: { id: 'in_2', amount_paid: 100, currency: 'usd', lines: { data: [] } } },
    }
    const onVercel = await deliver(source, event, 'shop.vercel.app', {}, { VERCEL: '1' })
    expect(selfCalls(onVercel).map((call) => call.url)).toEqual([
      'https://shop.vercel.app/api/invoices/generate',
    ])
    const local = await deliver(
      source,
      event,
      'localhost:3001',
      {},
      {
        NEXTAUTH_URL: 'http://localhost:3000',
      }
    )
    expect(selfCalls(local).map((call) => call.url)).toEqual([
      'http://localhost:3001/api/invoices/generate',
    ])
  })
})
