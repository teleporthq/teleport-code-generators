import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_get_product(config: any, context: Record<string, unknown>) {
  const productId = config.productId
  const secretKey = config.secretKey

  try {
    const response = await fetch('https://api.stripe.com/v1/products/' + productId, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + secretKey,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return { product: null, error: data.error ? data.error.message : 'Get product failed' }
    }

    return { product: data }
  } catch (err: unknown) {
    return { product: null, error: (err as Error).message }
  }
}
export const paymentGetProduct: NodeHandlerGenerator = {
  nodeType: 'payment-get-product',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_get_product)
  },
}
