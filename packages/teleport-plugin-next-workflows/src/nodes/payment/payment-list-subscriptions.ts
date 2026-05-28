import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_list_subscriptions(config: any, context: Record<string, unknown>) {
  const customerId = config.customerId
  const limit = config.limit || 10
  const offset = config.offset
  const secretKey = config.secretKey

  try {
    const params = new URLSearchParams()
    params.append('customer', customerId)
    params.append('limit', String(limit))
    if (offset) {
      params.append('starting_after', offset)
    }

    const response = await fetch('https://api.stripe.com/v1/subscriptions?' + params.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + secretKey,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        subscriptions: [],
        error: data.error ? data.error.message : 'List subscriptions failed',
      }
    }

    return { subscriptions: data.data || [] }
  } catch (err: unknown) {
    return { subscriptions: [], error: (err as Error).message }
  }
}
export const paymentListSubscriptions: NodeHandlerGenerator = {
  nodeType: 'payment-list-subscriptions',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_list_subscriptions)
  },
}
