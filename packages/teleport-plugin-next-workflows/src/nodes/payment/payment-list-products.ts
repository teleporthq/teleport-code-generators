import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_list_products(config: any, context: Record<string, unknown>) {
  const limit = config.limit || 10
  const offset = config.offset
  const secretKey = config.secretKey

  try {
    const params = new URLSearchParams()
    params.append('limit', String(limit))
    if (offset) {
      params.append('starting_after', offset)
    }

    const response = await fetch('https://api.stripe.com/v1/products?' + params.toString(), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + secretKey,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { products: [], error: data.error ? data.error.message : 'List products failed' }
    }

    return { products: data.data || [] }
  } catch (err: unknown) {
    return { products: [], error: (err as Error).message }
  }
}
export const paymentListProducts: NodeHandlerGenerator = {
  nodeType: 'payment-list-products',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_list_products)
  },
}
