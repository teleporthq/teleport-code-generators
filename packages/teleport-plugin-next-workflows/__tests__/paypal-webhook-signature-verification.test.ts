import { generatePaypalSignatureVerificationCode } from '../src/webhook-signature-verification'

/**
 * The PayPal verifier emitted into every workflow webhook route (the
 * `paypal-payment` route the store's payments, refunds and subscriptions all
 * arrive through). Executed, not pattern-matched: what matters is which
 * PayPal environment it calls and where it finds its credentials.
 *
 * Both PayPal environments issue client ids starting with "A", so the earlier
 * `startsWith('sb-')` check sent every sandbox verification to the live API,
 * which rejected the sandbox certificate — no sandbox webhook ever reached a
 * workflow. And a standalone run has only the `CONFIGURATION_*` names the
 * provider panel stores, which the verifier never read.
 */

type Verify = (
  req: { headers: Record<string, string> },
  rawBody: Buffer,
  webhookConfig: { signatureSecret?: string }
) => Promise<boolean>

interface Call {
  url: string
  body: string
}

const ENV_KEYS = [
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'CONFIGURATION_PAYPAL_CLIENT_ID',
  'CONFIGURATION_PAYPAL_CLIENT_SECRET',
  'CONFIGURATION_PAYPAL_WEBHOOK_ID',
  'CONFIGURATION_PAYPAL_WEBHOOK_ID_5F2A',
]

function load(): Verify {
  // eslint-disable-next-line no-new-func
  return new Function(
    `${generatePaypalSignatureVerificationCode()}; return verifyPaypalSignature;`
  )() as Verify
}

function installFetch(verificationStatus: string, calls: Call[]): void {
  ;(globalThis as any).fetch = async (url: string, init: { body: string }) => {
    calls.push({ url, body: init.body })
    if (url.endsWith('/v1/oauth2/token')) {
      return { json: async () => ({ access_token: 'tok' }) }
    }
    return { json: async () => ({ verification_status: verificationStatus }) }
  }
}

const event = { event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE1' } }
const headersFor = (certHost: string) => ({
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': `https://${certHost}/cert/cert-1`,
  'paypal-transmission-id': 'tid',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-09-24T10:00:00Z',
})

describe('generated PayPal webhook verifier', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const savedFetch = (globalThis as any).fetch
  let errors: jest.SpyInstance

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    errors = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    ;(globalThis as any).fetch = savedFetch
    errors.mockRestore()
  })

  it('verifies a sandbox event against the sandbox API, whatever the client id looks like', async () => {
    process.env.PAYPAL_CLIENT_ID = 'AbCsandboxLooksLikeLive'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    process.env.PAYPAL_WEBHOOK_ID = 'WH-1'
    const calls: Call[] = []
    installFetch('SUCCESS', calls)
    const verify = load()
    const ok = await verify(
      { headers: headersFor('api.sandbox.paypal.com') },
      Buffer.from(JSON.stringify(event)),
      { signatureSecret: 'PAYPAL_WEBHOOK_ID' }
    )
    expect(ok).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([
      'https://api-m.sandbox.paypal.com/v1/oauth2/token',
      'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
    ])
    const sent = JSON.parse(calls[1].body)
    expect(sent.webhook_id).toBe('WH-1')
    expect(sent.cert_url).toBe('https://api.sandbox.paypal.com/cert/cert-1')
    expect(sent.webhook_event).toEqual(event)
  })

  it('verifies a live event against the live API', async () => {
    process.env.PAYPAL_CLIENT_ID = 'AbC'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    process.env.PAYPAL_WEBHOOK_ID = 'WH-1'
    const calls: Call[] = []
    installFetch('SUCCESS', calls)
    const ok = await load()(
      { headers: headersFor('api.paypal.com') },
      Buffer.from(JSON.stringify(event)),
      { signatureSecret: 'PAYPAL_WEBHOOK_ID' }
    )
    expect(ok).toBe(true)
    expect(calls[0].url).toBe('https://api-m.paypal.com/v1/oauth2/token')
    expect(calls[1].url).toBe('https://api-m.paypal.com/v1/notifications/verify-webhook-signature')
  })

  it('reads the CONFIGURATION_* names a standalone run has, and the webhook id under the stored secret name', async () => {
    process.env.PAYPAL_CLIENT_ID = ''
    process.env.CONFIGURATION_PAYPAL_CLIENT_ID = 'AbC'
    process.env.CONFIGURATION_PAYPAL_CLIENT_SECRET = 'secret'
    process.env.CONFIGURATION_PAYPAL_WEBHOOK_ID_5F2A = 'WH-stored'
    const calls: Call[] = []
    installFetch('SUCCESS', calls)
    const ok = await load()(
      { headers: headersFor('api.sandbox.paypal.com') },
      Buffer.from(JSON.stringify(event)),
      { signatureSecret: 'CONFIGURATION_PAYPAL_WEBHOOK_ID_5F2A' }
    )
    expect(ok).toBe(true)
    expect(JSON.parse(calls[1].body).webhook_id).toBe('WH-stored')
    expect(calls[0].url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token')
  })

  it('refuses without calling PayPal when the credentials or the webhook id are missing, and says which', async () => {
    const calls: Call[] = []
    installFetch('SUCCESS', calls)
    expect(
      await load()({ headers: headersFor('api.paypal.com') }, Buffer.from('{}'), {
        signatureSecret: 'PAYPAL_WEBHOOK_ID',
      })
    ).toBe(false)
    expect(errors.mock.calls[0][0]).toContain('PAYPAL_CLIENT_ID')

    process.env.PAYPAL_CLIENT_ID = 'AbC'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    expect(
      await load()({ headers: headersFor('api.paypal.com') }, Buffer.from('{}'), {
        signatureSecret: 'PAYPAL_WEBHOOK_ID',
      })
    ).toBe(false)
    expect(errors.mock.calls[1][0]).toContain('PAYPAL_WEBHOOK_ID')
    expect(calls).toEqual([])
  })

  it('reports a rejection with the environment it asked', async () => {
    process.env.PAYPAL_CLIENT_ID = 'AbC'
    process.env.PAYPAL_CLIENT_SECRET = 'secret'
    process.env.PAYPAL_WEBHOOK_ID = 'WH-1'
    const calls: Call[] = []
    installFetch('FAILURE', calls)
    const ok = await load()(
      { headers: headersFor('api.sandbox.paypal.com') },
      Buffer.from(JSON.stringify(event)),
      { signatureSecret: 'PAYPAL_WEBHOOK_ID' }
    )
    expect(ok).toBe(false)
    expect(errors.mock.calls[0][0]).toContain('https://api-m.sandbox.paypal.com')
    expect(errors.mock.calls[0][0]).toContain('verification_status=FAILURE')
  })
})
