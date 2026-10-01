import * as crypto from 'crypto'
import { generateWebhookWorkflowAPIRoute } from '../src/api-route-generator'
import { loadServerRuntime } from './_helpers/load-server-runtime'
import { withEnv, withFetch } from './_helpers/fake-fetch'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'

/**
 * The generated webhook route EXECUTED end to end: a payment webhook is
 * always verified by the store's driver — whatever an older stored trigger
 * said — and the workflow runs on the body the driver vouched for; every
 * other webhook fails closed on a scheme or secret it cannot check.
 */

interface Reply {
  status: number
  body: any
}

interface DriverInput {
  headers: Record<string, string>
  rawBody: Buffer
  body: any
  url: string
  secret: string
}

type Verify = (
  input: DriverInput
) => Promise<{ ok: boolean; body?: unknown; retry?: boolean; reason?: string }>

const ECHO_URL = 'https://echo.test/received'

// One node that posts what the trigger received, so a test can read the body
// the workflow actually ran on.
const workflow = (webhookConfig: Record<string, unknown>) =>
  ({
    id: 'wf-1',
    name: 'Payment webhook',
    trigger: { type: 'event-webhook-triggered', nodeId: 't', scope: 'global', config: {} },
    nodes: [
      {
        id: 'echo',
        type: 'general-http-request',
        config: {
          url: ECHO_URL,
          method: 'POST',
          body: { type: 'workflowContext', nodeId: 't', path: ['body'] },
        },
        stepNumber: 1,
        label: 'Echo',
      },
    ],
    edges: [{ id: 'e1', source: 't', target: 'echo' }],
    webhookConfig: { httpMethod: 'POST', ...webhookConfig },
  } as any)

const loadRoute = (source: string, drivers: Record<string, { verifyWebhook: Verify }> | null) => {
  const runtime = { exports: loadServerRuntime() }
  const requireShim = (id: string) => {
    if (id.endsWith('/utils/workflows/server-runtime')) {
      return runtime.exports
    }
    if (id.endsWith('/utils/payments')) {
      if (!drivers) {
        throw new Error("Cannot find module '" + id + "'")
      }
      return { get: (providerId: string) => drivers[providerId] || null }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }
  const module = { exports: null as any }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', source)(module, {}, requireShim)
  return module.exports as (req: unknown, res: unknown) => Promise<void>
}

const post = async (
  handler: (req: unknown, res: unknown) => Promise<void>,
  body: string,
  headers: Record<string, string> = {}
): Promise<{ reply: Reply; ran: any[] }> => {
  const reply: Reply = { status: 0, body: null }
  const res = {
    status(code: number) {
      reply.status = code
      return {
        json(payload: unknown) {
          reply.body = payload
        },
      }
    },
  }
  const req = {
    method: 'POST',
    url: '/api/webhooks/x?attempt=2',
    query: { attempt: '2' },
    headers: { host: 'shop.test', 'content-type': 'application/json', ...headers },
    body: Buffer.from(body),
  }
  const ran: any[] = []
  await withFetch(
    (call) => {
      if (call.url === ECHO_URL) {
        ran.push(call.json)
      }
      return { status: 200, body: {} }
    },
    () => handler(req, res)
  )
  return { reply, ran }
}

const recordingDriver = (answer: Awaited<ReturnType<Verify>> | Error) => {
  const inputs: DriverInput[] = []
  const driver = {
    verifyWebhook: async (input: DriverInput) => {
      inputs.push(input)
      if (answer instanceof Error) {
        throw answer
      }
      return answer
    },
  }
  return { driver, inputs }
}

describe('generated webhook route — payment webhooks', () => {
  it('verifies an old stored trigger on a payment path even though it said not to', async () => {
    const { driver, inputs } = recordingDriver({ ok: false, reason: 'forged' })
    const source = generateWebhookWorkflowAPIRoute(
      workflow({ urlPath: 'webhooks/stripe-payment', verifySignature: false })
    )
    expect(source).toContain('"signatureAlgorithm": "payment-driver"')
    const { reply, ran } = await post(loadRoute(source, { stripe: driver }), '{"id":"evt_forged"}')
    expect(inputs).toHaveLength(1)
    expect(reply).toEqual({ status: 401, body: { error: 'Invalid signature' } })
    expect(ran).toEqual([])
  })

  it('verifies a payment-driver trigger that lost its provider through its payment path', async () => {
    for (const verifySignature of [false, true]) {
      const { driver, inputs } = recordingDriver({ ok: false, reason: 'forged' })
      const source = generateWebhookWorkflowAPIRoute(
        workflow({
          urlPath: 'webhooks/mollie-payment',
          signatureAlgorithm: 'payment-driver',
          verifySignature,
        })
      )
      const { reply, ran } = await post(loadRoute(source, { mollie: driver }), '{"id":"tr_x"}')
      expect(inputs).toHaveLength(1)
      expect(reply).toEqual({ status: 401, body: { error: 'Invalid signature' } })
      expect(ran).toEqual([])
    }
  })

  it('refuses every request of a payment-driver trigger whose provider it cannot tell', async () => {
    for (const trigger of [
      { urlPath: 'webhooks/orders', paymentProvider: 'bogus' },
      { urlPath: 'webhooks/orders' },
    ]) {
      for (const verifySignature of [false, true]) {
        const { driver, inputs } = recordingDriver({ ok: true, body: { id: 'evt_1' } })
        const source = generateWebhookWorkflowAPIRoute(
          workflow({ ...trigger, signatureAlgorithm: 'payment-driver', verifySignature })
        )
        const { reply, ran } = await post(loadRoute(source, { stripe: driver }), '{"id":"evt_1"}')
        expect(inputs).toHaveLength(0)
        expect(reply.status).toBe(401)
        expect(ran).toEqual([])
      }
    }
  })

  it('runs the workflow on the body the driver vouched for, never the posted one', async () => {
    const { driver, inputs } = recordingDriver({
      ok: true,
      body: { id: 'evt_1', type: 'checkout.session.completed', verified: true },
    })
    const source = generateWebhookWorkflowAPIRoute(
      workflow({
        urlPath: 'webhooks/stripe-payment',
        signatureAlgorithm: 'payment-driver',
        paymentProvider: 'stripe',
        signatureSecret: {
          type: 'dynamic',
          content: { referenceType: 'secret', id: 'STRIPE_WEBHOOK_SECRET' },
        },
      })
    )
    const { reply, ran } = await withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_1' }, () =>
      post(
        loadRoute(source, { stripe: driver }),
        '{"id":"evt_1","type":"checkout.session.completed","amount":1}',
        {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'shop.example',
          'stripe-signature': 't=1,v1=abc',
        }
      )
    )
    expect(reply).toEqual({ status: 200, body: { received: true } })
    expect(ran).toEqual([{ id: 'evt_1', type: 'checkout.session.completed', verified: true }])
    expect(inputs[0]).toMatchObject({
      // The whole URL the provider posted to, its query string included.
      url: 'https://shop.example/api/webhooks/x?attempt=2',
      secret: 'whsec_1',
      body: { id: 'evt_1', type: 'checkout.session.completed', amount: 1 },
    })
    expect(inputs[0].rawBody.toString('utf8')).toBe(
      '{"id":"evt_1","type":"checkout.session.completed","amount":1}'
    )
    expect(inputs[0].headers['stripe-signature']).toBe('t=1,v1=abc')
  })

  it('hands the driver no secret when the .env still holds the unresolved placeholder', async () => {
    const { driver, inputs } = recordingDriver({ ok: true, body: { id: 'evt_1' } })
    const source = generateWebhookWorkflowAPIRoute(
      workflow({
        urlPath: 'webhooks/stripe-payment',
        signatureAlgorithm: 'payment-driver',
        paymentProvider: 'stripe',
        signatureSecret: {
          type: 'dynamic',
          content: { referenceType: 'secret', id: 'STRIPE_WEBHOOK_SECRET' },
        },
      })
    )
    await withEnv(
      { STRIPE_WEBHOOK_SECRET: 'teleporthq.secrets.CONFIGURATION_STRIPE_WEBHOOK_SECRET' },
      () => post(loadRoute(source, { stripe: driver }), '{"id":"evt_1"}')
    )
    // The driver then reads the saved credential itself.
    expect(inputs[0].secret).toBe('')
  })

  it("verifies Square's signature over the notification URL with its query string, through the store's own driver", async () => {
    const square = loadPaymentDrivers({ ids: ['square'] })
    const source = generateWebhookWorkflowAPIRoute(
      workflow({
        urlPath: 'webhooks/square-payment',
        signatureAlgorithm: 'payment-driver',
        paymentProvider: 'square',
        signatureSecret: {
          type: 'dynamic',
          content: { referenceType: 'secret', id: 'SQUARE_WEBHOOK_SIGNATURE_KEY' },
        },
      })
    )
    const body = '{"type":"order.updated","data":{"object":{}}}'
    const sign = (url: string) =>
      crypto
        .createHmac('sha256', 'sq-key')
        .update(url + body)
        .digest('base64')
    const deliver = (signature: string) =>
      withEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: 'sq-key', SQUARE_NOTIFICATION_URL: undefined }, () =>
        post(loadRoute(source, { square: square.get('square') }), body, {
          'x-square-hmacsha256-signature': signature,
        })
      )
    // Square signs the URL it was registered with — here one with a query string.
    const signedWithQuery = await deliver(sign('https://shop.test/api/webhooks/x?attempt=2'))
    expect(signedWithQuery.reply).toEqual({ status: 200, body: { received: true } })
    expect(signedWithQuery.ran).toEqual([{ type: 'order.updated', data: { object: {} } }])
    const signedWithoutQuery = await deliver(sign('https://shop.test/api/webhooks/x'))
    expect(signedWithoutQuery.reply.status).toBe(401)
    expect(signedWithoutQuery.ran).toEqual([])
  })

  it('hands a form-encoded callback to the driver as fields', async () => {
    const { driver, inputs } = recordingDriver({
      ok: true,
      body: { resource: 'payment', id: 'tr_1', status: 'paid' },
    })
    const source = generateWebhookWorkflowAPIRoute(
      workflow({
        urlPath: 'webhooks/mollie-payment',
        signatureAlgorithm: 'payment-driver',
        paymentProvider: 'mollie',
      })
    )
    const { reply, ran } = await post(
      loadRoute(source, { mollie: driver }),
      'id=tr_1&note=a+b%21',
      {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      }
    )
    expect(reply.status).toBe(200)
    expect(inputs[0].body).toEqual({ id: 'tr_1', note: 'a b!' })
    expect(ran).toEqual([{ resource: 'payment', id: 'tr_1', status: 'paid' }])
  })

  it('asks the provider to deliver again while the payment cannot be checked (503)', async () => {
    for (const answer of [{ ok: false, retry: true }, new Error('socket hang up')]) {
      const { driver } = recordingDriver(answer as any)
      const source = generateWebhookWorkflowAPIRoute(
        workflow({
          urlPath: 'webhooks/coingate-payment',
          signatureAlgorithm: 'payment-driver',
          paymentProvider: 'coingate',
        })
      )
      const { reply, ran } = await post(loadRoute(source, { coingate: driver }), 'id=1', {
        'content-type': 'application/x-www-form-urlencoded',
      })
      expect(reply).toEqual({
        status: 503,
        body: { error: 'The payment could not be verified yet' },
      })
      expect(ran).toEqual([])
    }
  })

  it('refuses every delivery in a store that carries no driver for the provider', async () => {
    const source = generateWebhookWorkflowAPIRoute(workflow({ urlPath: 'webhooks/paddle-payment' }))
    const withoutModule = await post(loadRoute(source, null), '{}')
    expect(withoutModule.reply.status).toBe(401)
    const withoutDriver = await post(loadRoute(source, {}), '{}')
    expect(withoutDriver.reply.status).toBe(401)
    expect(withoutDriver.ran).toEqual([])
  })
})

describe('generated webhook route — other webhooks fail closed', () => {
  const secretName = 'HOOK_SECRET'
  const body = '{"hello":"world"}'
  const signature =
    'sha256=' + crypto.createHmac('sha256', 'hook-secret').update(body).digest('hex')
  const route = (config: Record<string, unknown>) =>
    loadRoute(
      generateWebhookWorkflowAPIRoute(
        workflow({
          urlPath: 'hooks/orders',
          verifySignature: true,
          signatureHeader: 'X-Signature',
          signatureSecret: secretName,
          ...config,
        })
      ),
      null
    )

  it('accepts a correct HMAC and refuses a wrong one', async () => {
    await withEnv({ [secretName]: 'hook-secret' }, async () => {
      expect(
        (
          await post(route({ signatureAlgorithm: 'hmac-sha256' }), body, {
            'x-signature': signature,
          })
        ).reply.status
      ).toBe(200)
      expect(
        (
          await post(route({ signatureAlgorithm: 'hmac-sha256' }), body, {
            'x-signature': 'sha256=00',
          })
        ).reply.status
      ).toBe(401)
    })
  })

  it('refuses when the named secret is not configured, even with an HMAC keyed on an empty string', async () => {
    const emptyKeyed = 'sha256=' + crypto.createHmac('sha256', '').update(body).digest('hex')
    await withEnv({ [secretName]: undefined }, async () => {
      const { reply, ran } = await post(route({ signatureAlgorithm: 'hmac-sha256' }), body, {
        'x-signature': emptyKeyed,
      })
      expect(reply.status).toBe(401)
      expect(ran).toEqual([])
    })
  })

  it('refuses a scheme it does not know', async () => {
    await withEnv({ [secretName]: 'hook-secret' }, async () => {
      expect(
        (
          await post(route({ signatureAlgorithm: 'rsa-made-up' }), body, {
            'x-signature': signature,
          })
        ).reply.status
      ).toBe(401)
    })
  })

  it('leaves a custom scheme to the workflow, and an unverified webhook runs as before', async () => {
    const custom = await post(route({ signatureAlgorithm: 'custom' }), body)
    expect(custom.reply.status).toBe(200)
    expect(custom.ran).toEqual([{ hello: 'world' }])
    const open = await post(route({ verifySignature: false }), body)
    expect(open.reply.status).toBe(200)
  })
})

describe('generated webhook route — settling a payment the store confirmed itself', () => {
  const source = generateWebhookWorkflowAPIRoute(
    workflow({
      urlPath: 'webhooks/paypal-payment',
      signatureAlgorithm: 'payment-driver',
      paymentProvider: 'paypal',
    })
  )
  const SECRET = { NEXTAUTH_SECRET: 'store-secret' }
  // What only the store's own server can send: the runtime's internal-call token.
  const internalToken = () =>
    withEnv(SECRET, async () =>
      String(
        loadServerRuntime().internalRequestHeaders({ headers: { host: 'shop.test' } })[
          'x-teleport-internal'
        ]
      )
    )
  const settling = (answer: unknown) => {
    const asked: unknown[] = []
    const verified: unknown[] = []
    const driver = {
      verifyWebhook: async (input: DriverInput) => {
        verified.push(input)
        return { ok: true, body: input.body }
      },
      reconcile: async (request: unknown) => {
        asked.push(request)
        return answer
      },
    }
    return { driver, asked, verified }
  }
  // The request claims more than an id: none of it may reach the workflow.
  const claim = JSON.stringify({
    teleportReconcile: { kind: 'order', id: 'ORDER-1' },
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: { amount: { value: '1000000.00', currency_code: 'USD' } },
  })
  const settled = {
    ok: true,
    body: {
      id: 'teleport-settle:CAP-1',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: { id: 'CAP-1' },
    },
  }

  it('refuses a settlement request without the internal-call token, with no weaker check', async () => {
    const { driver, asked, verified } = settling(settled)
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { reply, ran } = await withEnv(SECRET, () =>
        post(loadRoute(source, { paypal: driver }), claim, { 'x-teleport-internal': 'guessed' })
      )
      expect(reply).toEqual({ status: 401, body: { error: 'Invalid signature' } })
      expect(ran).toEqual([])
      expect(asked).toEqual([])
      // Not handed to the ordinary verification either.
      expect(verified).toEqual([])
    } finally {
      quiet.mockRestore()
    }
  })

  it("runs the workflow on the provider's own answer, never on the posted claim", async () => {
    const { driver, asked } = settling(settled)
    const token = await internalToken()
    const { reply, ran } = await withEnv(SECRET, () =>
      post(loadRoute(source, { paypal: driver }), claim, { 'x-teleport-internal': token })
    )
    expect(reply).toEqual({ status: 200, body: { received: true } })
    expect(asked).toEqual([{ kind: 'order', id: 'ORDER-1' }])
    expect(ran).toEqual([settled.body])
  })

  it('lets the re-read decide: an uncaptured order settles nothing, an outage asks again', async () => {
    const token = await internalToken()
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const uncaptured = settling({
        ok: false,
        reason: 'PayPal order ORDER-1 has no capture to settle.',
      })
      const refused = await withEnv(SECRET, () =>
        post(loadRoute(source, { paypal: uncaptured.driver }), claim, {
          'x-teleport-internal': token,
        })
      )
      expect(refused.reply.status).toBe(401)
      expect(refused.ran).toEqual([])
      const outage = settling({ ok: false, retry: true, reason: 'PayPal is down' })
      const retried = await withEnv(SECRET, () =>
        post(loadRoute(source, { paypal: outage.driver }), claim, { 'x-teleport-internal': token })
      )
      expect(retried.reply.status).toBe(503)
      expect(retried.ran).toEqual([])
    } finally {
      quiet.mockRestore()
    }
  })

  it('refuses when the store has no secret, or the provider cannot settle', async () => {
    const token = await internalToken()
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { driver, asked } = settling(settled)
      const unsigned = await withEnv({ NEXTAUTH_SECRET: undefined }, () =>
        post(loadRoute(source, { paypal: driver }), claim, { 'x-teleport-internal': token })
      )
      expect(unsigned.reply.status).toBe(401)
      expect(asked).toEqual([])
      const withoutReconcile = {
        verifyWebhook: async (input: DriverInput) => ({ ok: true, body: input.body }),
      }
      const unsupported = await withEnv(SECRET, () =>
        post(loadRoute(source, { paypal: withoutReconcile }), claim, {
          'x-teleport-internal': token,
        })
      )
      expect(unsupported.reply.status).toBe(401)
      expect(unsupported.ran).toEqual([])
    } finally {
      quiet.mockRestore()
    }
  })
})
