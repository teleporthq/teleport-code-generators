import { NodeHandlerGenerator, handlerToString } from '../types'

async function ecommerce_get_settings(_config: any, context: any) {
  const baseUrl = (context && context.__baseUrl) || ''
  try {
    const response = await fetch(baseUrl + '/api/ecommerce/settings', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return { error: 'Failed to load e-commerce settings' }
    }

    return await response.json()
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}

export const ecommerceGetSettings: NodeHandlerGenerator = {
  nodeType: 'ecommerce-get-settings',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(ecommerce_get_settings)
  },
}
