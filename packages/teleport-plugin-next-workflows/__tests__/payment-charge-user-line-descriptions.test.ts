import { loadHandler, HandlerFn } from './_helpers/load-handler'

/**
 * A line bought with product options carries its short configuration label as
 * `description` in the checkout's line items, and Stripe shows it under the
 * product on the hosted page and the receipt. Stripe rejects an empty-string
 * description, so a line without options must reach Stripe exactly as before.
 */

type SessionParams = Record<string, any>

const withFakeStripe = async (run: (sessions: SessionParams[]) => Promise<void>) => {
  const sessions: SessionParams[] = []
  function FakeStripe() {
    return {
      checkout: {
        sessions: {
          create: async (params: SessionParams) => {
            sessions.push(params)
            return { id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1' }
          },
        },
      },
    }
  }
  const scope = globalThis as { __non_webpack_require__?: unknown; __workflowUtils?: unknown }
  const savedKey = process.env.STRIPE_SECRET_KEY
  scope.__non_webpack_require__ = (name: string) => {
    if (name !== 'stripe') {
      throw new Error('unexpected require ' + name)
    }
    return FakeStripe
  }
  scope.__workflowUtils = { localizeHref: (href: string) => href }
  process.env.STRIPE_SECRET_KEY = 'sk_test_1'
  try {
    await run(sessions)
  } finally {
    delete scope.__non_webpack_require__
    delete scope.__workflowUtils
    if (savedKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY
    } else {
      process.env.STRIPE_SECRET_KEY = savedKey
    }
  }
}

describe('payment-charge-user — Stripe line descriptions', () => {
  const handler: HandlerFn = loadHandler('payment-charge-user')
  const charge = (lineItems: unknown[]) =>
    handler(
      {
        providerId: 'stripe',
        amount: 41,
        currency: 'usd',
        successUrl: 'https://store.test/order-details/ORD-1',
        cancelUrl: 'https://store.test/checkout',
        lineItems,
      },
      {}
    )

  it('sends the configuration label as the product description', async () => {
    await withFakeStripe(async (sessions) => {
      await charge([
        {
          name: 'Photo print',
          unitAmount: 27,
          quantity: 1,
          description: '  Size: A3 · Paper: Glossy  ',
        },
      ])
      expect(sessions[0].line_items[0].price_data.product_data).toEqual({
        name: 'Photo print',
        description: 'Size: A3 · Paper: Glossy',
      })
    })
  })

  it('omits the description when a line has none, an empty one or a non-string', async () => {
    await withFakeStripe(async (sessions) => {
      await charge([
        { name: 'Mug', unitAmount: 12, quantity: 2 },
        { name: 'Tote', unitAmount: 8, quantity: 1, description: '   ' },
        { name: 'Cap', unitAmount: 6, quantity: 1, description: { label: 'x' } },
      ])
      expect(
        sessions[0].line_items.map((line: SessionParams) => line.price_data.product_data)
      ).toEqual([{ name: 'Mug' }, { name: 'Tote' }, { name: 'Cap' }])
    })
  })

  it('caps the description at the 500 characters Stripe accepts', async () => {
    await withFakeStripe(async (sessions) => {
      await charge([
        { name: 'Engraved pen', unitAmount: 20, quantity: 1, description: 'E'.repeat(700) },
      ])
      expect(sessions[0].line_items[0].price_data.product_data.description).toBe('E'.repeat(500))
    })
  })

  it('keeps the single-line session for a charge without line items', async () => {
    await withFakeStripe(async (sessions) => {
      await handler(
        {
          providerId: 'stripe',
          amount: 41,
          currency: 'usd',
          description: 'Order ORD-1',
          successUrl: 'https://store.test/done',
          cancelUrl: 'https://store.test/checkout',
        },
        {}
      )
      expect(sessions[0].line_items).toEqual([
        {
          price_data: { currency: 'usd', product_data: { name: 'Order ORD-1' }, unit_amount: 4100 },
          quantity: 1,
        },
      ])
    })
  })
})
