import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_create_subscription(config: any, context: Record<string, unknown>) {
  const customerId = config.customerId
  const planId = config.planId
  const secretKey = config.secretKey

  try {
    const params = new URLSearchParams()
    params.append('customer', customerId)
    params.append('items[0][price]', planId)

    const response = await fetch('https://api.stripe.com/v1/subscriptions', {
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
        subscriptionId: '',
        error: data.error ? data.error.message : 'Create subscription failed',
      }
    }

    return { subscriptionId: data.id || '' }
  } catch (err: unknown) {
    return { subscriptionId: '', error: (err as Error).message }
  }
}
export const paymentCreateSubscription: NodeHandlerGenerator = {
  nodeType: 'payment-create-subscription',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_create_subscription)
  },
}
