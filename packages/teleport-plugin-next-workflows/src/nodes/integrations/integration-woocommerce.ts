import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_woocommerce(config: any, context: Record<string, unknown>) {
  // Safely parse a fetch response: providers (Dropbox, Stripe legacy errors,
  // Slack rate-limit pages, …) sometimes return plain text on failure.
  // We read once as text and only parse JSON when it actually parses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __readJson = async (resp: any): Promise<any> => {
    const text = await resp.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text)
    } catch (e: unknown) {
      void e
      return { error_summary: text, error: text, message: text, raw: text }
    }
  }
  const consumerKey = config.consumerKey
  const consumerSecret = config.consumerSecret
  const storeUrl = config.storeUrl
  const action = config.action
  const baseUrl = storeUrl.replace(/\/$/, '') + '/wp-json/wc/v3/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(consumerKey + ':' + consumerSecret),
  }

  switch (action) {
    case 'create-product': {
      const response = await fetch(baseUrl + 'products', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: config.name,
          type: config.type || 'simple',
          regular_price: config.regularPrice,
          description: config.description || '',
          short_description: config.shortDescription || '',
          categories: config.categories || [],
          images: config.images || [],
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create product' }
      }
      return { success: true, product: data }
    }
    case 'get-product': {
      const response = await fetch(baseUrl + 'products/' + config.productId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get product' }
      }
      return { success: true, product: data }
    }
    case 'list-products': {
      let url = baseUrl + 'products'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.search) {
        params.push('search=' + encodeURIComponent(config.search))
      }
      if (config.category) {
        params.push('category=' + config.category)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list products' }
      }
      return { success: true, products: data }
    }
    case 'update-product': {
      const body: Record<string, any> = config.updates || {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.regularPrice !== undefined) {
        body.regular_price = config.regularPrice
      }
      const response = await fetch(baseUrl + 'products/' + config.productId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update product' }
      }
      return { success: true, product: data }
    }
    case 'delete-product': {
      const response = await fetch(
        baseUrl + 'products/' + config.productId + '?force=' + (config.force || true),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete' }
      }
      return { success: true }
    }
    case 'create-order': {
      const response = await fetch(baseUrl + 'orders', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.order || {
            line_items: config.lineItems || [],
            billing: config.billing || {},
            shipping: config.shipping || {},
          }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create order' }
      }
      return { success: true, order: data }
    }
    case 'get-order': {
      const response = await fetch(baseUrl + 'orders/' + config.orderId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get order' }
      }
      return { success: true, order: data }
    }
    case 'update-order': {
      const response = await fetch(baseUrl + 'orders/' + config.orderId, {
        method: 'PUT',
        headers,
        body: JSON.stringify(config.updates || {}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update order' }
      }
      return { success: true, order: data }
    }
    case 'list-orders': {
      let url = baseUrl + 'orders'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url += '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list orders' }
      }
      return { success: true, orders: data }
    }
    case 'create-customer': {
      const response = await fetch(baseUrl + 'customers', {
        method: 'POST',
        headers,
        body: JSON.stringify(
          config.customer || {
            email: config.email,
            first_name: config.firstName,
            last_name: config.lastName,
          }
        ),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create customer' }
      }
      return { success: true, customer: data }
    }
    case 'get-customer': {
      const response = await fetch(baseUrl + 'customers/' + config.customerId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get customer' }
      }
      return { success: true, customer: data }
    }
    case 'list-customers': {
      let url = baseUrl + 'customers'
      if (config.perPage) {
        url += '?per_page=' + config.perPage
      }
      if (config.page) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'page=' + config.page
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list customers' }
      }
      return { success: true, customers: data }
    }
    default:
      throw new Error('Unknown integration-woocommerce action: ' + action)
  }
}
export const integrationWoocommerce: IntegrationHandlerGenerator = {
  nodeType: 'integration-woocommerce',
  executionEnv: 'server',
  secretFields: ['consumerKey', 'consumerSecret', 'storeUrl'],
  generateHandler(): string {
    return handlerToString(integration_woocommerce)
  },
}
