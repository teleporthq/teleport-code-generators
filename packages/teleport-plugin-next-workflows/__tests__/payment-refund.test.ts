import { loadHandler, HandlerFn } from './_helpers/load-handler'
import { paymentRefund } from '../src/nodes/payment/payment-refund'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { collectSecrets } from '../src/secret-collector'

interface RefundResult {
  success: boolean
  refundId: string
  amount: number
  currency: string
  status: string
  error: string
}

describe('payment-refund', () => {
  const handler: HandlerFn = loadHandler('payment-refund')
  const source = paymentRefund.generateHandler()

  it('is a SERVER node that continues the workflow', () => {
    expect(paymentRefund.executionEnv).toBe('server')
    // Unlike a charge, a refund must NOT be terminal: the steps that record it,
    // restock it and email the buyer all run after it.
    expect(paymentRefund.isTerminal).toBe(false)
  })

  it('has its provider credentials collected into the generated env', () => {
    // Without this the exported project ships with no key for the refund node
    // and every refund fails at runtime with "not configured".
    const secrets = collectSecrets({
      workflows: {
        wf1: {
          nodes: [
            {
              id: 'node-1',
              type: 'payment-refund',
              config: { secretKey: 'sk_test_1', clientId: 'id_1', clientSecret: 'cs_1' },
            },
          ],
        },
      },
    } as never)
    expect(secrets.map((secret) => secret.fieldName).sort()).toEqual([
      'clientId',
      'clientSecret',
      'secretKey',
    ])
  })

  it('resolves its own entry point out of the concatenated source', () => {
    // The entry has to be the FIRST statement-level two-parameter function, or
    // the generated route calls a helper instead.
    expect(resolveHandlerEntryName(source, 'payment-refund')).toBe('payment_refund')
  })

  it('reads process through globalThis, which webpack leaves alone', () => {
    // A bare `process` is rewritten by the GUI's browser packer into a name
    // that does not exist on the Vercel Node runtime.
    expect(source).toContain('globalThis.process.env')
    // …and nowhere is `process.env` read WITHOUT that prefix.
    expect(source.replace(/globalThis\.process\.env/g, '')).not.toContain('process.env')
  })

  it('keeps each currency list in the SAME snapshot as the code that reads it', () => {
    // A declaration in one `.toString()`'d function and its reference in
    // another is the "Oo is not defined" bug — a minifier renames the two
    // independently and the generated file references a name it never declares.
    // Slicing the emitted source per function is the only way to check that.
    for (const fnName of ['toProviderMinorUnits', 'fromProviderMinorUnits']) {
      const start = source.indexOf(`function ${fnName}`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = source.indexOf('\nfunction ', start + 1)
      const body = next === -1 ? source.slice(start) : source.slice(start, next)
      expect(body).toContain('zeroDecimalCurrencies = [')
      expect(body).toContain('threeDecimalCurrencies = [')
      expect(body).toContain('zeroDecimalCurrencies.indexOf')
    }
  })

  it('refuses without a payment reference instead of calling a provider', async () => {
    const result = (await handler({ currency: 'usd' }, {})) as RefundResult
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no payment reference/i)
    expect(result.refundId).toBe('')
  })

  it('reports missing Stripe credentials as an actionable error', async () => {
    const saved = process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    try {
      const result = (await handler(
        { providerType: 'stripe', paymentReference: 'pi_1', currency: 'usd' },
        {}
      )) as RefundResult
      expect(result.success).toBe(false)
      expect(result.error).toContain('STRIPE_SECRET_KEY')
      // The shape stays constant on every path, so a downstream node can bind
      // to it without knowing which branch ran.
      expect(result).toMatchObject({ refundId: '', amount: 0, status: '' })
    } finally {
      if (saved !== undefined) {
        process.env.STRIPE_SECRET_KEY = saved
      }
    }
  })

  it('reports missing PayPal credentials without attempting a network call', async () => {
    const savedId = process.env.PAYPAL_CLIENT_ID
    const savedSecret = process.env.PAYPAL_CLIENT_SECRET
    delete process.env.PAYPAL_CLIENT_ID
    delete process.env.PAYPAL_CLIENT_SECRET
    try {
      const result = (await handler(
        { providerType: 'paypal', paymentReference: 'cap_1', currency: 'usd' },
        {}
      )) as RefundResult
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/PayPal credentials are not configured/i)
    } finally {
      if (savedId !== undefined) {
        process.env.PAYPAL_CLIENT_ID = savedId
      }
      if (savedSecret !== undefined) {
        process.env.PAYPAL_CLIENT_SECRET = savedSecret
      }
    }
  })

  it('always returns an answer rather than throwing, so bookkeeping can still run', async () => {
    // A declined refund is a branch the workflow takes, not a crash that takes
    // the whole segment — including the steps that record what happened — down.
    await expect(
      handler({ providerType: 'stripe', paymentReference: 'pi_1', currency: 'usd' }, {})
    ).resolves.toBeDefined()
  })
})
