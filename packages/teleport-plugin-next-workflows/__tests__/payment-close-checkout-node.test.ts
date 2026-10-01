import { loadHandler } from './_helpers/load-handler'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'

/**
 * `payment-close-checkout`: before an unpaid order is settled or cancelled
 * another way, the checkout it has open is closed, so no page the store
 * opened can take its money afterwards. EXECUTED through the handler with the
 * store's real composition (`core.closeOrderCheckouts`) over a fake driver.
 */

const { core } = loadPaymentDrivers({ ids: [] })

const run = async (config: Record<string, unknown>, state: unknown) => {
  const closed: string[] = []
  const driver = {
    closeCheckout: async ({ reference }: { reference: string }) => {
      closed.push(reference)
      if (state instanceof Error) {
        throw state
      }
      return state
    },
    findCheckouts: async () => ({ references: ['found-1'] }),
  }
  const handler = loadHandler('payment-close-checkout', {
    paymentDrivers: {
      ids: ['mollie'],
      core,
      get: (id: string) => (id === 'mollie' ? driver : null),
    },
  })
  const result = (await handler({ providerId: 'mollie', ...config }, {})) as Record<string, string>
  return { result, closed }
}

describe('payment-close-checkout', () => {
  it('does nothing without a purpose or a provider', async () => {
    for (const config of [{ purpose: '' }, { purpose: 'settle', providerId: '' }]) {
      const { result, closed } = await run({ reference: 'tr_1', ...config }, { state: 'closed' })
      expect(result).toEqual({ allowed: 'true', outcome: 'skipped', openUntil: '', message: '' })
      expect(closed).toEqual([])
    }
  })

  it('allows settling or cancelling once the page is closed', async () => {
    for (const purpose of ['settle', 'cancel']) {
      const { result, closed } = await run({ purpose, reference: 'tr_1' }, { state: 'closed' })
      expect(result).toEqual({ allowed: 'true', outcome: 'closed', openUntil: '', message: '' })
      expect(closed).toEqual(['tr_1'])
    }
  })

  it('looks the page up when the order recorded none', async () => {
    const { closed } = await run(
      { purpose: 'cancel', orderId: 'o-1', placedAt: '2026-09-28T10:00:00Z' },
      { state: 'closed' }
    )
    expect(closed).toEqual(['found-1'])
  })

  it('lets a payment the provider took be marked paid, never cancelled', async () => {
    expect(
      (await run({ purpose: 'settle', reference: 'tr_1' }, { state: 'paid' })).result.allowed
    ).toBe('true')
    const { result } = await run({ purpose: 'cancel', reference: 'tr_1' }, { state: 'paid' })
    expect(result.allowed).toBe('false')
    expect(result.message).toBe(
      'The buyer has already paid this order through Mollie. Refund the payment instead of cancelling the order.'
    )
  })

  it('refuses while a payment is being confirmed', async () => {
    const { result } = await run({ purpose: 'settle', reference: 'tr_1' }, { state: 'confirming' })
    expect(result).toMatchObject({ allowed: 'false', outcome: 'confirming' })
  })

  it('refuses until a page the provider cannot close runs out, saying when', async () => {
    const { result } = await run(
      { purpose: 'settle', reference: 'tr_1' },
      { state: 'open', openUntil: '2026-09-28T10:15:00.000Z', checkoutUrl: 'https://mollie/1' }
    )
    expect(result).toEqual({
      allowed: 'false',
      outcome: 'open',
      openUntil: '2026-09-28T10:15:00.000Z',
      message:
        "The buyer's Mollie payment page for this order stays open until 2026-09-28 10:15 UTC, and Mollie can't close it early. Try again after that, so the order can't be paid twice.",
    })
  })

  it('refuses when the provider cannot be asked, and never answers with an error key', async () => {
    const { result } = await run(
      { purpose: 'cancel', reference: 'tr_1' },
      new Error('socket hang up')
    )
    expect(result).toMatchObject({ allowed: 'false', outcome: 'error' })
    expect(result.message).toContain('socket hang up')
    expect(result).not.toHaveProperty('error')
  })

  it('closes the page a lost record left open, and only that one', async () => {
    const created = await run(
      { purpose: 'abandon', reference: 'tr_9', attemptOutcome: 'created', recorded: '' },
      { state: 'closed' }
    )
    expect(created.closed).toEqual(['tr_9'])
    expect(created.result.allowed).toBe('true')
    for (const config of [
      { attemptOutcome: 'created', recorded: 'true' },
      { attemptOutcome: 'reused', recorded: '' },
      { attemptOutcome: 'adopted', recorded: '' },
    ]) {
      const { result, closed } = await run(
        { purpose: 'abandon', reference: 'tr_9', ...config },
        { state: 'closed' }
      )
      expect(closed).toEqual([])
      expect(result.outcome).toBe('skipped')
    }
  })

  it('refuses a provider the store carries no driver for', async () => {
    const { result } = await run({ purpose: 'settle', providerId: 'klarna', reference: 'x' }, {})
    expect(result.allowed).toBe('false')
    expect(result.message).toContain('klarna')
  })
})
