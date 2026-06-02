import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_create_customer(config: any, _context: Record<string, unknown>) {
  const provider = config.provider || 'stripe'
  const email = config.email
  const name = config.name
  // metadata may arrive as a JSON string (as payment-charge-user also handles);
  // Object.keys on a string would yield numeric index keys and garbage params.
  let metadata = config.metadata || {}
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata)
    } catch (e) {
      metadata = {}
    }
  }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    metadata = {}
  }

  if (!email) {
    return { customerId: '', provider, error: 'Email is required to create a customer' }
  }

  if (provider === 'paypal') {
    return { customerId: email, provider: 'paypal' }
  }

  const secretKey = config.secretKey
  if (!secretKey) {
    return { customerId: '', provider: 'stripe', error: 'Stripe secret key is required' }
  }

  try {
    const params = new URLSearchParams()
    params.append('email', email)
    if (name) {
      params.append('name', name)
    }

    const metaKeys = Object.keys(metadata)
    for (let i = 0; i < metaKeys.length; i++) {
      params.append('metadata[' + metaKeys[i] + ']', String(metadata[metaKeys[i]]))
    }

    const response = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        customerId: '',
        provider: 'stripe',
        error: data.error ? data.error.message : 'Create customer failed',
      }
    }

    return { customerId: data.id || '', provider: 'stripe' }
  } catch (err: unknown) {
    return { customerId: '', provider: 'stripe', error: (err as Error).message }
  }
}
export const paymentCreateCustomer: NodeHandlerGenerator = {
  nodeType: 'payment-create-customer',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_create_customer)
  },
}
