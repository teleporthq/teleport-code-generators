import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_update_customer(config: any, context: Record<string, unknown>) {
  const customerId = config.customerId
  const fields = config.fields || {}
  const secretKey = config.secretKey

  try {
    const params = new URLSearchParams()
    const fieldKeys = Object.keys(fields)
    for (let i = 0; i < fieldKeys.length; i++) {
      const key = fieldKeys[i]
      const val = fields[key]
      if (typeof val === 'object' && val !== null) {
        const subKeys = Object.keys(val)
        for (let j = 0; j < subKeys.length; j++) {
          params.append(key + '[' + subKeys[j] + ']', String(val[subKeys[j]]))
        }
      } else {
        params.append(key, String(val))
      }
    }

    const response = await fetch('https://api.stripe.com/v1/customers/' + customerId, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      return { customer: null, error: data.error ? data.error.message : 'Update customer failed' }
    }

    return { customer: data }
  } catch (err: unknown) {
    return { customer: null, error: (err as Error).message }
  }
}
export const paymentUpdateCustomer: NodeHandlerGenerator = {
  nodeType: 'payment-update-customer',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_update_customer)
  },
}
