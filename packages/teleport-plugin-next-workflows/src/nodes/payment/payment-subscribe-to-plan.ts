import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_subscribe_to_plan(config: any, context: Record<string, unknown>) {
  const planId = config.planId
  const customerId = config.customerId
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
        status: 'failed',
        error: data.error ? data.error.message : 'Subscription failed',
      }
    }

    return {
      subscriptionId: data.id || '',
      status: data.status || '',
    }
  } catch (err: unknown) {
    return { subscriptionId: '', status: 'failed', error: (err as Error).message }
  }
}
export const paymentSubscribeToPlan: NodeHandlerGenerator = {
  nodeType: 'payment-subscribe-to-plan',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_subscribe_to_plan)
  },
}
