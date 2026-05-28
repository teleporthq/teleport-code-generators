import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_get_customer(config: any, context: Record<string, unknown>) {
  const customerId = config.customerId
  const secretKey = config.secretKey

  try {
    const response = await fetch('https://api.stripe.com/v1/customers/' + customerId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + secretKey,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { customer: null, error: data.error ? data.error.message : 'Get customer failed' }
    }

    return { customer: data }
  } catch (err: unknown) {
    return { customer: null, error: (err as Error).message }
  }
}
export const paymentGetCustomer: NodeHandlerGenerator = {
  nodeType: 'payment-get-customer',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_get_customer)
  },
}
