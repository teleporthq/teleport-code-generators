import { NodeHandlerGenerator, handlerToString } from '../types'

async function payment_create_product(config: any, context: Record<string, unknown>) {
  const name = config.name
  const description = config.description || ''
  const price = config.price
  const currency = config.currency || 'usd'
  const secretKey = config.secretKey

  try {
    const productParams = new URLSearchParams()
    productParams.append('name', name)
    if (description) {
      productParams.append('description', description)
    }

    const productResponse = await fetch('https://api.stripe.com/v1/products', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: productParams.toString(),
    })

    const productData = await productResponse.json()

    if (!productResponse.ok) {
      return {
        productId: '',
        error: productData.error ? productData.error.message : 'Create product failed',
      }
    }

    const priceParams = new URLSearchParams()
    priceParams.append('product', productData.id)
    priceParams.append('unit_amount', String(price))
    priceParams.append('currency', currency)

    const priceResponse = await fetch('https://api.stripe.com/v1/prices', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: priceParams.toString(),
    })

    const priceData = await priceResponse.json()

    if (!priceResponse.ok) {
      return {
        productId: productData.id,
        error: priceData.error ? priceData.error.message : 'Create price failed',
      }
    }

    return { productId: productData.id || '' }
  } catch (err: unknown) {
    return { productId: '', error: (err as Error).message }
  }
}
export const paymentCreateProduct: NodeHandlerGenerator = {
  nodeType: 'payment-create-product',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(payment_create_product)
  },
}
