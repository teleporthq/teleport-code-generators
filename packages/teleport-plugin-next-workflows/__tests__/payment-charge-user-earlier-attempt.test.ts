import { loadHandler } from './_helpers/load-handler'
import { PaymentDriverRegistry, loadPaymentDrivers } from './_helpers/load-payment-drivers'

/**
 * `payment-charge-user` with the checkout an order opened earlier
 * (`previousAttempt`): the node asks the provider about it before opening
 * another, because two open checkouts are how one order gets paid twice.
 * With `deferRedirect` it answers with the page instead of sending the buyer
 * there, so the workflow can record the checkout first.
 */

interface FakeDriverCalls {
  inspected: unknown[]
  created: any[]
}

const fakeDriver = (inspection: unknown, calls: FakeDriverCalls) => ({
  inspectCheckout: async (input: unknown) => {
    calls.inspected.push(input)
    if (inspection instanceof Error) {
      throw inspection
    }
    return inspection
  },
  createCheckout: async (input: any) => {
    calls.created.push(input)
    return { checkoutUrl: 'https://pay.test/new', sessionId: 'new-1' }
  },
})

const registryOf = (driver: unknown): PaymentDriverRegistry => ({
  ids: ['stripe'],
  core: {},
  get: (id: string) => (id === 'stripe' ? driver : null),
})

const CHARGE = {
  providerId: 'stripe',
  amount: 20,
  currency: 'eur',
  successUrl: '/order-details/ORD-1?payment=success',
  cancelUrl: '/order-details/ORD-1',
  metadata: '{"orderId":"order-1","orderNumber":"ORD-1"}',
}
const CONTEXT = { __baseUrl: 'https://shop.test' }

const run = async (inspection: unknown, config: Record<string, unknown>) => {
  const calls: FakeDriverCalls = { inspected: [], created: [] }
  const handler = loadHandler('payment-charge-user', {
    paymentDrivers: registryOf(fakeDriver(inspection, calls)),
  })
  const result = (await handler({ ...CHARGE, ...config }, CONTEXT)) as Record<string, unknown>
  return { result, calls }
}

describe('payment-charge-user — the checkout opened earlier', () => {
  beforeAll(() => {
    ;(globalThis as { __workflowUtils?: unknown }).__workflowUtils = {
      localizeHref: (href: string) => href,
    }
  })
  afterAll(() => {
    delete (globalThis as { __workflowUtils?: unknown }).__workflowUtils
  })

  it('sends the buyer back to a checkout they can still pay, opening no other', async () => {
    const { result, calls } = await run(
      { state: 'open', checkoutUrl: 'https://pay.test/earlier' },
      { previousAttempt: 'cs_earlier', deferRedirect: true }
    )
    expect(calls.inspected).toEqual([{ reference: 'cs_earlier' }])
    expect(calls.created).toEqual([])
    expect(result).toEqual({
      checkoutUrl: 'https://pay.test/earlier',
      sessionId: 'cs_earlier',
      attemptRef: 'cs_earlier',
      attemptOutcome: 'reused',
      redirectUrl: 'https://pay.test/earlier',
    })
  })

  it.each(['paid', 'confirming'])(
    'opens nothing while the earlier checkout is %s, and points the buyer at the confirmation',
    async (state) => {
      const { result, calls } = await run(
        { state, checkoutUrl: '' },
        { previousAttempt: 'cs_earlier', deferRedirect: true }
      )
      expect(calls.created).toEqual([])
      expect(result).toEqual({
        checkoutUrl: '',
        sessionId: 'cs_earlier',
        attemptRef: 'cs_earlier',
        attemptOutcome: 'in-progress',
        redirectUrl: 'https://shop.test/order-details/ORD-1?payment=success',
      })
    }
  )

  it('opens a new checkout once the earlier one can take no more money', async () => {
    const { result, calls } = await run(
      { state: 'closed', checkoutUrl: '' },
      { previousAttempt: 'cs_earlier', deferRedirect: true }
    )
    expect(calls.created).toHaveLength(1)
    // The driver learns which checkout this one follows (Square keys its link on it).
    expect(calls.created[0].previousAttempt).toBe('cs_earlier')
    expect(result).toEqual({
      checkoutUrl: 'https://pay.test/new',
      sessionId: 'new-1',
      attemptRef: 'new-1',
      attemptOutcome: 'created',
      redirectUrl: 'https://pay.test/new',
    })
  })

  it('refuses with a 400 when the provider cannot say what became of the earlier checkout', async () => {
    for (const inspection of [
      { state: '', checkoutUrl: '', error: 'Stripe is unavailable' },
      new Error('socket hang up'),
    ]) {
      const { result, calls } = await run(inspection, {
        previousAttempt: 'cs_earlier',
        deferRedirect: true,
      })
      expect(calls.created).toEqual([])
      expect(result).toMatchObject({ __earlyResponse: { status: 400 } })
    }
  })

  it('opens a checkout without asking anyone when no earlier one is known', async () => {
    const { result, calls } = await run(new Error('never asked'), { deferRedirect: 'true' })
    expect(calls.inspected).toEqual([])
    expect(calls.created).toHaveLength(1)
    expect(result.attemptOutcome).toBe('created')
    expect(result).not.toHaveProperty('__terminal')
  })

  it('without deferRedirect stays terminal, and sends a payment in progress to the confirmation', async () => {
    const { result } = await run({ state: 'confirming' }, { previousAttempt: 'cs_earlier' })
    expect(result).toMatchObject({
      __terminal: true,
      __redirectUrl: 'https://shop.test/order-details/ORD-1?payment=success',
      attemptOutcome: 'in-progress',
    })
  })

  it('opens a checkout as before with a driver that cannot inspect one', async () => {
    const calls: FakeDriverCalls = { inspected: [], created: [] }
    const { inspectCheckout, ...withoutInspect } = fakeDriver({ state: 'open' }, calls)
    expect(typeof inspectCheckout).toBe('function')
    const handler = loadHandler('payment-charge-user', {
      paymentDrivers: registryOf(withoutInspect),
    })
    const result = await handler({ ...CHARGE, previousAttempt: 'cs_earlier' }, CONTEXT)
    expect(calls.created).toHaveLength(1)
    expect(result).toMatchObject({ attemptOutcome: 'created', __terminal: true })
  })
})

describe('payment-charge-user — an order that recorded no checkout', () => {
  const PLACED_AT = '2026-09-28T10:00:00.000Z'
  const { core } = loadPaymentDrivers({ ids: [] })

  beforeAll(() => {
    ;(globalThis as { __workflowUtils?: unknown }).__workflowUtils = {
      localizeHref: (href: string) => href,
    }
  })
  afterAll(() => {
    delete (globalThis as { __workflowUtils?: unknown }).__workflowUtils
  })

  const lookup = async (found: unknown, states: Record<string, unknown> = {}) => {
    const calls = { found: [] as unknown[], closed: [] as string[], created: [] as unknown[] }
    const driver = {
      findCheckouts: async (input: unknown) => {
        calls.found.push(input)
        return found
      },
      closeCheckout: async ({ reference }: { reference: string }) => {
        calls.closed.push(reference)
        return states[reference]
      },
      createCheckout: async (input: unknown) => {
        calls.created.push(input)
        return { checkoutUrl: 'https://pay.test/new', sessionId: 'new-1' }
      },
    }
    const handler = loadHandler('payment-charge-user', {
      paymentDrivers: {
        ids: ['stripe'],
        core,
        get: (id: string) => (id === 'stripe' ? driver : null),
      },
    })
    const result = (await handler(
      { ...CHARGE, deferRedirect: true, lookupOrderId: 'order-1', lookupPlacedAt: PLACED_AT },
      CONTEXT
    )) as Record<string, unknown>
    return { result, calls }
  }

  it('closes the pages its placing opened, then opens a new one', async () => {
    const { result, calls } = await lookup({ references: ['cs_a'] }, { cs_a: { state: 'closed' } })
    expect(calls.found).toEqual([{ orderId: 'order-1', placedAt: PLACED_AT }])
    expect(calls.closed).toEqual(['cs_a'])
    expect(calls.created).toHaveLength(1)
    expect(result).toMatchObject({ attemptOutcome: 'created', attemptRef: 'new-1' })
  })

  it('opens nothing when a page it finds took the money, or is taking it', async () => {
    for (const state of ['paid', 'confirming']) {
      const { result, calls } = await lookup({ references: ['cs_a'] }, { cs_a: { state } })
      expect(calls.created).toEqual([])
      expect(result).toMatchObject({
        attemptOutcome: 'in-progress',
        attemptRef: '',
        redirectUrl: 'https://shop.test/order-details/ORD-1?payment=success',
      })
    }
  })

  it('reopens a page the provider cannot close, answered to be recorded', async () => {
    const { result, calls } = await lookup(
      { references: ['42'] },
      {
        42: {
          state: 'open',
          checkoutUrl: 'https://coingate.test/42',
          openUntil: '2026-09-28T10:20:00Z',
        },
      }
    )
    expect(calls.created).toEqual([])
    expect(result).toEqual({
      checkoutUrl: 'https://coingate.test/42',
      sessionId: '42',
      attemptRef: '42',
      attemptOutcome: 'adopted',
      redirectUrl: 'https://coingate.test/42',
    })
  })

  it('waits out a page it cannot find (PayPal), saying until when', async () => {
    const until = new Date(Date.now() + 3 * 60 * 60 * 1000)
    const { result, calls } = await lookup({ searchable: false, openUntil: until.toISOString() })
    expect(calls.created).toEqual([])
    const early = result.__earlyResponse as { status: number; body: { error: string } }
    expect(early.status).toBe(400)
    expect(early.body.error).toContain(until.toISOString().slice(0, 16).replace('T', ' ') + ' UTC')
  })

  it('opens a new page once a page it cannot find has certainly run out', async () => {
    const { result, calls } = await lookup({ searchable: false, openUntil: PLACED_AT })
    expect(calls.created).toHaveLength(1)
    expect(result.attemptOutcome).toBe('created')
  })

  it('refuses when the provider cannot be searched', async () => {
    const { result, calls } = await lookup({ error: 'Stripe is down' })
    expect(calls.created).toEqual([])
    expect(result).toMatchObject({
      __earlyResponse: { status: 400, body: { error: 'Stripe is down' } },
    })
  })
})
