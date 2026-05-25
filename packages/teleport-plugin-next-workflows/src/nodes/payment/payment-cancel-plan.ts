import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_cancel_plan(config: any, context: Record<string, unknown>) {
  const subscriptionId = config.subscriptionId
  const secretKey = config.secretKey

  try {
    const response = await fetch('https://api.stripe.com/v1/subscriptions/' + subscriptionId, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { success: false, error: data.error ? data.error.message : 'Cancel failed' }
    }

    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const paymentCancelPlan: NodeHandlerGenerator = {
  nodeType: 'payment-cancel-plan',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_cancel_plan)
  },
}
