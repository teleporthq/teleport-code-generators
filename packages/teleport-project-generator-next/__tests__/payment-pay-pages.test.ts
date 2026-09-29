import * as ts from 'typescript'
import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'
import {
  generatePaddlePayPage,
  generateRazorpayPayPage,
} from '../src/ecommerce/payment-pages-generator'
import {
  generatePaymentConfirmApiRoute,
  generatePaypalCaptureApiRoute,
} from '../src/ecommerce/ecommerce-api-routes-generator'

/**
 * The store's own payment pages (`/pay/paddle`, `/pay/razorpay`) and the
 * PayPal return capture, EXECUTED: compiled the way Next compiles them, the
 * server half asked for a real driver answer, the browser half run against a
 * fake provider script.
 */

const compile = (source: string, exposeForTest = ''): string =>
  ts.transpileModule(source + exposeForTest, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2019,
    },
  }).outputText

const evaluate = (
  code: string,
  drivers: Record<string, unknown> | null,
  serverRuntime: Record<string, unknown> | null = null
) => {
  const module = { exports: {} as any }
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime') && serverRuntime) {
      return serverRuntime
    }
    if (id === 'react') {
      return {
        useEffect: (): void => undefined,
        useState: (value: unknown): unknown[] => [value, (): void => undefined],
        createElement: (): null => null,
      }
    }
    if (id.endsWith('/utils/payments')) {
      if (!drivers) {
        throw new Error("Cannot find module '" + id + "'")
      }
      return { get: (providerId: string) => drivers[providerId] || null }
    }
    throw new Error('unexpected require ' + id)
  }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', code)(module, module.exports, requireShim)
  return module.exports
}

// A browser just rich enough for the page's loader: the appended script
// "loads" at once, after the test installed the provider's global.
const withBrowser = async (
  provider: Record<string, unknown>,
  run: (location: { href: string }) => void | Promise<void>
) => {
  const scope = globalThis as Record<string, any>
  const saved = { window: scope.window, document: scope.document }
  const location = { href: 'https://shop.test/pay', origin: 'https://shop.test' }
  const appended: string[] = []
  scope.window = { ...provider, location }
  scope.document = {
    createElement: () => ({}),
    head: {
      appendChild: (script: { src: string; onload: () => void }) => {
        appended.push(script.src)
        script.onload()
      },
    },
  }
  try {
    await run(location)
  } finally {
    scope.window = saved.window
    scope.document = saved.document
  }
  return appended
}

describe('/pay/paddle', () => {
  const page = {
    transactionId: 'txn_01',
    token: 'test_tok',
    sandbox: true,
    successUrl: 'https://shop.test/ok',
    cancelUrl: 'https://shop.test/checkout',
  }

  it('asks the Paddle driver about the transaction in the URL', async () => {
    const asked: string[] = []
    const exported = evaluate(compile(generatePaddlePayPage()), {
      paddle: {
        checkoutPage: async (id: string) => {
          asked.push(id)
          return id === 'txn_01' ? page : null
        },
      },
    })
    expect(await exported.getServerSideProps({ query: { _ptxn: 'txn_01' } })).toEqual({
      props: page,
    })
    expect(await exported.getServerSideProps({ query: { _ptxn: 'txn_other' } })).toEqual({
      notFound: true,
    })
    expect(await exported.getServerSideProps({ query: {} })).toEqual({ notFound: true })
    expect(asked).toEqual(['txn_01', 'txn_other', ''])
  })

  it('is a 404 in a store without the module or without a Paddle driver', async () => {
    expect(
      await evaluate(compile(generatePaddlePayPage()), null).getServerSideProps({
        query: { _ptxn: 'txn_01' },
      })
    ).toEqual({ notFound: true })
    expect(
      await evaluate(compile(generatePaddlePayPage()), {}).getServerSideProps({
        query: { _ptxn: 'txn_01' },
      })
    ).toEqual({ notFound: true })
  })

  it('opens Paddle in the right environment and sends a buyer who closes it back to the store', async () => {
    const { openCheckout } = evaluate(
      compile(generatePaddlePayPage(), '\nexports.openCheckout = openCheckout'),
      {}
    )
    const calls: any[] = []
    let callback: (event: { name: string }) => void = () => undefined
    const paddle = {
      Environment: { set: (value: string): number => calls.push(['environment', value]) },
      Initialize: (options: any) => {
        calls.push(['initialize', { token: options.token, checkout: options.checkout }])
        callback = options.eventCallback
      },
    }
    const scripts = await withBrowser({ Paddle: paddle }, (location) => {
      openCheckout(page, () => calls.push(['failed']))
      callback({ name: 'checkout.closed' })
      expect(location.href).toBe('https://shop.test/checkout')
    })
    expect(scripts).toEqual(['https://cdn.paddle.com/paddle/v2/paddle.js'])
    expect(calls).toEqual([
      ['environment', 'sandbox'],
      [
        'initialize',
        { token: 'test_tok', checkout: { settings: { successUrl: 'https://shop.test/ok' } } },
      ],
    ])
    await withBrowser({ Paddle: paddle }, (location) => {
      openCheckout({ ...page, sandbox: false }, (): void => undefined)
      callback({ name: 'checkout.completed' })
      callback({ name: 'checkout.closed' })
      expect(location.href).toBe('https://shop.test/pay')
    })
    expect(calls.filter((call) => call[0] === 'environment')).toHaveLength(1)
  })

  it('reports a checkout that could not load', async () => {
    const { openCheckout } = evaluate(
      compile(generatePaddlePayPage(), '\nexports.openCheckout = openCheckout'),
      {}
    )
    let failed = false
    await withBrowser({}, () => {
      openCheckout(page, () => {
        failed = true
      })
    })
    expect(failed).toBe(true)
  })
})

describe('/pay/razorpay', () => {
  const page = {
    subscriptionId: 'sub_1',
    keyId: 'rzp_test_key',
    successUrl: 'https://shop.test/ok',
    cancelUrl: 'https://shop.test/checkout',
  }

  it('asks the Razorpay driver about the subscription in the URL', async () => {
    const exported = evaluate(compile(generateRazorpayPayPage()), {
      razorpay: { checkoutPage: async (id: string) => (id === 'sub_1' ? page : null) },
    })
    expect(await exported.getServerSideProps({ query: { subscription: 'sub_1' } })).toEqual({
      props: page,
    })
    expect(await exported.getServerSideProps({ query: { subscription: 'sub_2' } })).toEqual({
      notFound: true,
    })
  })

  it('authorises the subscription with the public key id, then sends the buyer on', async () => {
    const { openCheckout } = evaluate(
      compile(generateRazorpayPayPage(), '\nexports.openCheckout = openCheckout'),
      {}
    )
    let options: any = null
    let opened = 0
    function Razorpay(this: unknown, given: any) {
      options = given
      return { open: (): number => opened++ }
    }
    const scripts = await withBrowser({ Razorpay }, (location) => {
      openCheckout(page, (): void => undefined)
      expect(options).toMatchObject({ key: 'rzp_test_key', subscription_id: 'sub_1' })
      expect(opened).toBe(1)
      options.modal.ondismiss()
      expect(location.href).toBe('https://shop.test/checkout')
      options.handler({ razorpay_payment_id: 'pay_1' })
      expect(location.href).toBe('https://shop.test/ok')
    })
    expect(scripts).toEqual(['https://checkout.razorpay.com/v1/checkout.js'])
  })
})

// The success and cancel addresses come back from the provider, where the
// checkout that opened it stored them: the pages must not be an open redirect.
describe('where a pay page may send the buyer', () => {
  const hostile = [
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example/phish',
    ' https://evil.example',
    'https://shop.test.evil.example/ok',
    'https://shop.test@evil.example/ok',
    'http://shop.test/ok',
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://shop.test/5f0c',
    'https://[',
  ]

  it('keeps an address of the store, made absolute, and turns anything else into the home page', async () => {
    for (const generate of [generatePaddlePayPage, generateRazorpayPayPage]) {
      const { safeRedirect } = evaluate(
        compile(generate(), '\nexports.safeRedirect = safeRedirect'),
        {}
      )
      await withBrowser({}, () => {
        expect(safeRedirect('/order-details/ORD-42?paid=1')).toBe(
          'https://shop.test/order-details/ORD-42?paid=1'
        )
        expect(safeRedirect('https://shop.test/ok#top')).toBe('https://shop.test/ok#top')
        expect(safeRedirect('thanks')).toBe('https://shop.test/thanks')
        expect(safeRedirect('')).toBe('https://shop.test/')
        expect(safeRedirect(undefined)).toBe('https://shop.test/')
        for (const url of hostile) {
          expect([url, safeRedirect(url)]).toEqual([url, 'https://shop.test/'])
        }
      })
    }
  })

  it('never hands Paddle, or follows on close, an address off the store', async () => {
    const { openCheckout } = evaluate(
      compile(generatePaddlePayPage(), '\nexports.openCheckout = openCheckout'),
      {}
    )
    let options: any = null
    const paddle = {
      Environment: { set: (): void => undefined },
      Initialize: (given: any) => {
        options = given
      },
    }
    await withBrowser({ Paddle: paddle }, (location) => {
      openCheckout(
        {
          token: 'test_tok',
          successUrl: 'https://evil.example/ok',
          cancelUrl: 'javascript:alert(1)',
        },
        (): void => undefined
      )
      expect(options.checkout.settings).toEqual({ successUrl: 'https://shop.test/' })
      options.eventCallback({ name: 'checkout.closed' })
      expect(location.href).toBe('https://shop.test/')
    })
    await withBrowser({ Paddle: paddle }, (location) => {
      openCheckout(
        { token: 'test_tok', successUrl: '/order-details/ORD-42', cancelUrl: '/checkout' },
        (): void => undefined
      )
      expect(options.checkout.settings).toEqual({
        successUrl: 'https://shop.test/order-details/ORD-42',
      })
      options.eventCallback({ name: 'checkout.closed' })
      expect(location.href).toBe('https://shop.test/checkout')
    })
  })

  it('never sends a Razorpay buyer off the store after paying or dismissing', async () => {
    const { openCheckout } = evaluate(
      compile(generateRazorpayPayPage(), '\nexports.openCheckout = openCheckout'),
      {}
    )
    let options: any = null
    function Razorpay(this: unknown, given: any) {
      options = given
      return { open: (): void => undefined }
    }
    await withBrowser({ Razorpay }, (location) => {
      openCheckout(
        {
          subscriptionId: 'sub_1',
          keyId: 'rzp_test_key',
          successUrl: '//evil.example/ok',
          cancelUrl: 'data:text/html,hi',
        },
        (): void => undefined
      )
      options.modal.ondismiss()
      expect(location.href).toBe('https://shop.test/')
      location.href = 'https://shop.test/pay'
      options.handler({ razorpay_payment_id: 'pay_1' })
      expect(location.href).toBe('https://shop.test/')
    })
    // No success address at all still lands on the store.
    await withBrowser({ Razorpay }, (location) => {
      openCheckout({ subscriptionId: 'sub_1', keyId: 'rzp_test_key' }, (): void => undefined)
      options.handler({ razorpay_payment_id: 'pay_1' })
      expect(location.href).toBe('https://shop.test/')
    })
  })
})

// A fetch that answers each settlement request with `answer(body)`'s status,
// with NEXTAUTH_URL set to `canonicalUrl` and off Vercel.
const withFetch = async (
  answer: (body: any) => number,
  exercise: (posted: Array<{ url: string; headers: any; body: any }>) => Promise<void>,
  canonicalUrl: string | null = 'https://shop.test'
) => {
  const scope = globalThis as Record<string, any>
  const saved = scope.fetch
  const savedUrl = process.env.NEXTAUTH_URL
  const savedVercel = process.env.VERCEL
  delete process.env.VERCEL
  if (canonicalUrl === null) {
    delete process.env.NEXTAUTH_URL
  } else {
    process.env.NEXTAUTH_URL = canonicalUrl
  }
  const posted: Array<{ url: string; headers: any; body: any }> = []
  scope.fetch = async (url: string, init: { headers: any; body: string }) => {
    const body = JSON.parse(init.body)
    posted.push({ url, headers: init.headers, body })
    const status = answer(body)
    return { ok: status >= 200 && status < 300, status }
  }
  try {
    await exercise(posted)
  } finally {
    scope.fetch = saved
    if (savedUrl === undefined) {
      delete process.env.NEXTAUTH_URL
    } else {
      process.env.NEXTAUTH_URL = savedUrl
    }
    if (savedVercel !== undefined) {
      process.env.VERCEL = savedVercel
    }
  }
}

describe('/api/ecommerce/paypal/capture', () => {
  const run = async (
    drivers: Record<string, unknown> | null,
    body: unknown,
    method = 'POST',
    settle: { url: string; runtime: Record<string, unknown> } | null = null
  ) => {
    const handler = evaluate(
      compile(generatePaypalCaptureApiRoute(settle ? settle.url : null)),
      drivers,
      settle ? settle.runtime : null
    ).default
    const reply = { status: 0, body: null as any }
    await handler(
      { method, body },
      {
        status(code: number) {
          reply.status = code
          return {
            json(payload: unknown) {
              reply.body = payload
              return reply
            },
          }
        },
      }
    )
    return reply
  }

  it('captures the returned order through the PayPal driver', async () => {
    const asked: unknown[] = []
    const paypal = {
      confirmReturn: async (input: unknown) => {
        asked.push(input)
        return { handled: true, ok: true, alreadyCaptured: true, status: 'COMPLETED' }
      },
    }
    expect(await run({ paypal }, { token: 'ORDER-1' })).toEqual({
      status: 200,
      body: {
        success: true,
        alreadyCaptured: true,
        orderId: 'ORDER-1',
        status: 'COMPLETED',
        // No workflow receives PayPal's webhook: the capture alone runs.
        settled: false,
      },
    })
    expect(asked).toEqual([{ query: { token: 'ORDER-1' } }])
  })

  describe("settles through the store's own PayPal webhook", () => {
    const runtime = {
      trustedBaseUrl: (): string => 'https://shop.test',
      internalRequestHeaders: (): Record<string, string> => ({ 'x-teleport-internal': 'token' }),
    }
    const settle = { url: '/api/webhooks/paypal-payment', runtime }
    const captured = {
      paypal: {
        confirmReturn: async () => ({ handled: true, ok: true, status: 'COMPLETED' }),
      },
    }

    it('settles a captured order with nothing but its PayPal id, as the store server', async () => {
      await withFetch(
        () => 200,
        async (posted) => {
          const reply = await run(captured, { orderId: 'ORDER-1' }, 'POST', settle)
          expect(reply).toMatchObject({ status: 200, body: { success: true, settled: true } })
          expect(posted).toEqual([
            {
              url: 'https://shop.test/api/webhooks/paypal-payment',
              headers: { 'Content-Type': 'application/json', 'x-teleport-internal': 'token' },
              body: { teleportReconcile: { kind: 'order', id: 'ORDER-1' } },
            },
          ])
        }
      )
    })

    it("settles a subscription's mandate, then its first payment", async () => {
      await withFetch(
        (body) => (body.teleportReconcile.kind === 'subscription' ? 200 : 401),
        async (posted) => {
          const reply = await run(captured, { subscriptionId: 'I-BW452GLLEP1G' }, 'POST', settle)
          // The first payment was not taken yet: PayPal's webhook settles it later.
          expect(reply).toEqual({
            status: 200,
            body: { success: true, subscriptionId: 'I-BW452GLLEP1G', settled: false },
          })
          expect(posted.map((call) => call.body.teleportReconcile)).toEqual([
            { kind: 'subscription', id: 'I-BW452GLLEP1G' },
            { kind: 'subscription-payment', id: 'I-BW452GLLEP1G' },
          ])
        }
      )
      expect(
        (await run(captured, { subscriptionId: 'BA-not-a-subscription' }, 'POST', settle)).status
      ).toBe(400)
    })

    it('never sends the internal token to a host the request named', async () => {
      // Off Vercel, without NEXTAUTH_URL, the base URL is the Host header's.
      await withFetch(
        () => 200,
        async (posted) => {
          const reply = await run(captured, { subscriptionId: 'I-BW452GLLEP1G' }, 'POST', settle)
          expect(reply.body).toMatchObject({ success: true, settled: false })
          expect(posted).toEqual([])
        },
        null
      )
    })

    it('still answers the capture when the settlement cannot be asked', async () => {
      const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        await withFetch(
          () => {
            throw new Error('connection refused')
          },
          async () => {
            expect(await run(captured, { orderId: 'ORDER-1' }, 'POST', settle)).toMatchObject({
              status: 200,
              body: { success: true, settled: false },
            })
          }
        )
      } finally {
        quiet.mockRestore()
      }
    })
  })

  it('reports a refused capture, a missing driver and a missing id', async () => {
    const refusing = {
      paypal: {
        confirmReturn: async () => ({ handled: true, ok: false, error: 'INSTRUMENT_DECLINED' }),
      },
    }
    expect(await run(refusing, { orderId: 'ORDER-1' })).toEqual({
      status: 502,
      body: { error: 'INSTRUMENT_DECLINED' },
    })
    expect((await run(null, { orderId: 'ORDER-1' })).status).toBe(500)
    expect((await run(refusing, {})).status).toBe(400)
    expect((await run(refusing, { orderId: 42 })).status).toBe(400)
    expect((await run(refusing, { orderId: 'ORDER-1' }, 'GET')).status).toBe(405)
  })

  it('answers an order the store closed as refused, not as a failed capture', async () => {
    const closed = {
      paypal: {
        confirmReturn: async () => ({
          handled: true,
          ok: false,
          retryable: false,
          closed: true,
          error: 'The store closed PayPal order ORDER-1, so it was not captured.',
        }),
      },
    }
    expect(await run(closed, { orderId: 'ORDER-1' })).toEqual({
      status: 409,
      body: { error: 'The store closed PayPal order ORDER-1, so it was not captured.' },
    })
  })
})

describe('/api/ecommerce/payments/confirm', () => {
  const runtime = {
    trustedBaseUrl: (): string => 'https://shop.test',
    internalRequestHeaders: (): Record<string, string> => ({ 'x-teleport-internal': 'token' }),
  }
  const settleUrls = {
    mollie: '/api/webhooks/mollie-payment',
    stripe: '/api/webhooks/stripe-payment',
  }
  const drivers = {
    mollie: { reconcileKinds: (reference: string) => (/^tr_/.test(reference) ? ['checkout'] : []) },
    stripe: {
      reconcileKinds: (reference: string) =>
        /^cs_/.test(reference) ? ['checkout', 'checkout-invoice'] : [],
    },
  }
  const run = async (body: unknown, method = 'POST', stores = drivers) => {
    const handler = evaluate(
      compile(generatePaymentConfirmApiRoute(settleUrls)),
      stores,
      runtime
    ).default
    const reply = { status: 0, body: null as any }
    await handler(
      { method, body },
      {
        status(code: number) {
          reply.status = code
          return {
            json(payload: unknown) {
              reply.body = payload
              return reply
            },
          }
        },
      }
    )
    return reply
  }

  it("settles the order's checkout through that provider's webhook route, as the store server", async () => {
    await withFetch(
      () => 200,
      async (posted) => {
        expect(await run({ provider: 'Mollie', reference: ' tr_WDqYK6vllg ' })).toEqual({
          status: 200,
          body: { success: true, settled: true },
        })
        expect(posted).toEqual([
          {
            url: 'https://shop.test/api/webhooks/mollie-payment',
            headers: { 'Content-Type': 'application/json', 'x-teleport-internal': 'token' },
            body: { teleportReconcile: { kind: 'checkout', id: 'tr_WDqYK6vllg' } },
          },
        ])
      }
    )
  })

  it('asks every kind the driver names, in order, and says whether any settled', async () => {
    await withFetch(
      (body) => (body.teleportReconcile.kind === 'checkout' ? 200 : 401),
      async (posted) => {
        expect((await run({ provider: 'stripe', reference: 'cs_test_a1' })).body).toEqual({
          success: true,
          settled: true,
        })
        expect(posted.map((call) => call.body.teleportReconcile.kind)).toEqual([
          'checkout',
          'checkout-invoice',
        ])
      }
    )
    // Nothing to settle yet: the checkout is still open at the provider.
    await withFetch(
      () => 401,
      async () => {
        expect((await run({ provider: 'mollie', reference: 'tr_open' })).body).toEqual({
          success: true,
          settled: false,
        })
      }
    )
  })

  it('refuses a provider the store cannot settle, a foreign reference and a GET', async () => {
    await withFetch(
      () => 200,
      async (posted) => {
        expect((await run({ provider: 'paddle', reference: 'txn_1' })).status).toBe(400)
        expect((await run({ provider: 'mollie', reference: 'cs_test_a1' })).status).toBe(400)
        expect((await run({ provider: 'mollie', reference: '' })).status).toBe(400)
        expect((await run({ provider: 'mollie', reference: 'tr_' + 'x'.repeat(300) })).status).toBe(
          400
        )
        expect((await run({ provider: 'constructor', reference: 'tr_1' })).status).toBe(400)
        expect((await run({ provider: 'mollie', reference: 42 })).status).toBe(400)
        expect((await run({ provider: 'mollie', reference: 'tr_1' }, 'GET')).status).toBe(405)
        expect(
          (await run({ provider: 'mollie', reference: 'tr_1' }, 'POST', {} as never)).status
        ).toBe(400)
        expect(posted).toEqual([])
      }
    )
  })

  it('never sends the internal token to a host the request named', async () => {
    await withFetch(
      () => 200,
      async (posted) => {
        expect((await run({ provider: 'mollie', reference: 'tr_1' })).body).toEqual({
          success: true,
          settled: false,
        })
        expect(posted).toEqual([])
      },
      null
    )
  })
})

describe('what the store generator emits for its providers', () => {
  const build = (paymentProviders: unknown[]) =>
    ({
      uidl: {
        globals: { env: {} },
        ecommerceSettings: { guestCheckout: true, cashOnDelivery: false, paymentProviders },
      },
      files: new Map([
        [
          '_app',
          {
            path: ['pages'],
            files: [
              {
                name: '_app',
                fileType: 'js',
                content: 'export default function MyApp() { return null }',
              },
            ],
          },
        ],
      ]),
      dependencies: {},
      devDependencies: {},
    } as unknown as ProjectPluginStructure)

  it('adds each browser checkout page, the PayPal capture and every driver the store uses', async () => {
    const structure = build([
      { type: 'paddle', credentials: { apiKey: 'CONFIGURATION_PADDLE_API_KEY' } },
      { type: 'razorpay' },
      { type: 'paypal' },
    ])
    await new NextEcommerceProjectPlugin().runAfter(structure)
    expect(structure.files.get('payment-page-paddle').path).toEqual(['pages', 'pay'])
    expect(structure.files.get('payment-page-razorpay').files[0].name).toBe('razorpay')
    expect(structure.files.has('ecommerce-api-paypal-capture')).toBe(true)
    expect(structure.files.get('payment-drivers-drivers').files.map((file) => file.name)).toEqual([
      'stripe',
      'paypal',
      'razorpay',
      'paddle',
    ])
    expect(structure.uidl.globals.env).toMatchObject({
      PADDLE_API_KEY: 'teleporthq.secrets.CONFIGURATION_PADDLE_API_KEY',
      PAYPAL_CLIENT_ID: '',
      PAYPAL_CLIENT_SECRET: '',
      PAYPAL_WEBHOOK_ID: '',
    })
    expect(structure.uidl.globals.env.STRIPE_SECRET_KEY).toBeUndefined()
  })

  it('adds the payment confirmation for every provider whose webhook route can settle', async () => {
    const structure = build([{ type: 'mollie' }, { type: 'stripe' }])
    ;(structure.uidl as any).workflows = {
      workflows: {
        mollieHook: {
          name: 'Mollie Payment Webhook',
          trigger: { type: 'event-webhook-received' },
          webhookConfig: { urlPath: '/api/webhooks/mollie-payment' },
        },
      },
    }
    await new NextEcommerceProjectPlugin().runAfter(structure)
    const route = structure.files.get('ecommerce-api-payment-confirm')
    expect(route.path).toEqual(['pages', 'api', 'ecommerce', 'payments'])
    expect(route.files[0].name).toBe('confirm')
    expect(route.files[0].content).toContain(
      'var SETTLE_URLS = {"mollie":"/api/webhooks/mollie-payment"}'
    )
  })

  it('emits no page, capture route or driver for a store without those providers', async () => {
    const structure = build([{ type: 'stripe' }])
    await new NextEcommerceProjectPlugin().runAfter(structure)
    // No workflow receives a provider's webhook: nothing could settle.
    expect(structure.files.has('ecommerce-api-payment-confirm')).toBe(false)
    expect(structure.files.has('payment-page-paddle')).toBe(false)
    expect(structure.files.has('payment-page-razorpay')).toBe(false)
    expect(structure.files.has('ecommerce-api-paypal-capture')).toBe(false)
    expect(structure.files.has('ecommerce-api-checkout')).toBe(false)
    expect(structure.uidl.globals.env).toMatchObject({
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
    })
  })
})
