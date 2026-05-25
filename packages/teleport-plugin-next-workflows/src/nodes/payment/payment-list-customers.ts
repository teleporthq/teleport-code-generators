import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_list_customers(config: any, context: Record<string, unknown>) {
  const limit = config.limit || 10
  const offset = config.offset
  const secretKey = config.secretKey

  try {
    const params = new URLSearchParams()
    params.append('limit', String(limit))
    if (offset) {
      params.append('starting_after', offset)
    }

    const response = await fetch('https://api.stripe.com/v1/customers?' + params.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + secretKey,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { customers: [], error: data.error ? data.error.message : 'List customers failed' }
    }

    return { customers: data.data || [] }
  } catch (err: unknown) {
    return { customers: [], error: (err as Error).message }
  }
}
export const paymentListCustomers: NodeHandlerGenerator = {
  nodeType: 'payment-list-customers',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_list_customers)
  },
}
