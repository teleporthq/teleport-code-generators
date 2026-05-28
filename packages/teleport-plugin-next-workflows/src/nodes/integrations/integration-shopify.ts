import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_shopify(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken
  const storeDomain = config.storeDomain
  const action = config.action
  const baseUrl = 'https://' + storeDomain + '/admin/api/2024-01/'
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  }

  switch (action) {
    case 'list-products': {
      let url = baseUrl + 'products.json'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.sinceId) {
        params.push('since_id=' + config.sinceId)
      }
      if (config.title) {
        params.push('title=' + encodeURIComponent(config.title))
      }
      if (config.vendor) {
        params.push('vendor=' + encodeURIComponent(config.vendor))
      }
      if (config.productType) {
        params.push('product_type=' + encodeURIComponent(config.productType))
      }
      if (config.collectionId) {
        params.push('collection_id=' + config.collectionId)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to list products' }
      }
      return { success: true, products: data.products || [] }
    }
    case 'create-order': {
      const body: Record<string, any> = {
        order: {
          line_items: config.lineItems || [],
          financial_status: config.financialStatus || 'pending',
        },
      }
      if (config.email) {
        body.order.email = config.email
      }
      if (config.shippingAddress) {
        body.order.shipping_address = config.shippingAddress
      }
      if (config.billingAddress) {
        body.order.billing_address = config.billingAddress
      }
      if (config.note) {
        body.order.note = config.note
      }
      if (config.tags) {
        body.order.tags = config.tags
      }
      if (config.currency) {
        body.order.currency = config.currency
      }
      if (config.customerId) {
        body.order.customer = { id: config.customerId }
      }
      const response = await fetch(baseUrl + 'orders.json', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to create order' }
      }
      return { success: true, order: data.order }
    }
    case 'get-order': {
      let url = baseUrl + 'orders/' + config.orderId + '.json'
      const params = []
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields.join(',')))
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to get order' }
      }
      return { success: true, order: data.order }
    }
    case 'create-product': {
      const product: Record<string, any> = { title: config.title }
      if (config.bodyHtml) {
        product.body_html = config.bodyHtml
      }
      if (config.vendor) {
        product.vendor = config.vendor
      }
      if (config.productType) {
        product.product_type = config.productType
      }
      if (config.status) {
        product.status = config.status
      }
      if (config.variants) {
        product.variants = config.variants
      }
      const response = await fetch(baseUrl + 'products.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({ product }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.errors && JSON.stringify(data.errors)) || 'Failed to create product',
        }
      }
      return { success: true, product: data.product }
    }
    case 'get-product': {
      const response = await fetch(baseUrl + 'products/' + config.productId + '.json', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to get product' }
      }
      return { success: true, product: data.product }
    }
    case 'update-product': {
      const product: Record<string, any> = {}
      if (config.title !== undefined) {
        product.title = config.title
      }
      if (config.bodyHtml !== undefined) {
        product.body_html = config.bodyHtml
      }
      if (config.status !== undefined) {
        product.status = config.status
      }
      const response = await fetch(baseUrl + 'products/' + config.productId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ product }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to update product' }
      }
      return { success: true, product: data.product }
    }
    case 'delete-product': {
      const response = await fetch(baseUrl + 'products/' + config.productId + '.json', {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.errors || 'Failed to delete product' }
      }
      return { success: true }
    }
    case 'update-order': {
      const order: Record<string, any> = {}
      if (config.note !== undefined) {
        order.note = config.note
      }
      if (config.tags !== undefined) {
        order.tags = config.tags
      }
      const response = await fetch(baseUrl + 'orders/' + config.orderId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ order }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to update order' }
      }
      return { success: true, order: data.order }
    }
    case 'cancel-order': {
      const response = await fetch(baseUrl + 'orders/' + config.orderId + '/cancel.json', {
        method: 'POST',
        headers,
        body: '{}',
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to cancel order' }
      }
      return { success: true, order: data.order }
    }
    case 'list-orders': {
      let url = baseUrl + 'orders.json'
      const params = []
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.sinceId) {
        params.push('since_id=' + config.sinceId)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to list orders' }
      }
      return { success: true, orders: data.orders || [] }
    }
    case 'create-customer': {
      const customer: Record<string, any> = { email: config.email }
      if (config.firstName) {
        customer.first_name = config.firstName
      }
      if (config.lastName) {
        customer.last_name = config.lastName
      }
      if (config.phone) {
        customer.phone = config.phone
      }
      const response = await fetch(baseUrl + 'customers.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({ customer }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to create customer' }
      }
      return { success: true, customer: data.customer }
    }
    case 'get-customer': {
      const response = await fetch(baseUrl + 'customers/' + config.customerId + '.json', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to get customer' }
      }
      return { success: true, customer: data.customer }
    }
    case 'update-customer': {
      const customer: Record<string, any> = {}
      if (config.email !== undefined) {
        customer.email = config.email
      }
      if (config.firstName !== undefined) {
        customer.first_name = config.firstName
      }
      if (config.lastName !== undefined) {
        customer.last_name = config.lastName
      }
      const response = await fetch(baseUrl + 'customers/' + config.customerId + '.json', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ customer }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to update customer' }
      }
      return { success: true, customer: data.customer }
    }
    case 'delete-customer': {
      const response = await fetch(baseUrl + 'customers/' + config.customerId + '.json', {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.errors || 'Failed to delete customer' }
      }
      return { success: true }
    }
    case 'search-customers': {
      const query = config.query || ''
      const response = await fetch(
        baseUrl +
          'customers/search.json?query=' +
          encodeURIComponent(query) +
          (config.limit ? '&limit=' + config.limit : ''),
        { method: 'GET', headers }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to search customers' }
      }
      return { success: true, customers: data.customers || [] }
    }
    case 'create-variant': {
      const variant: Record<string, any> = {}
      if (config.price) {
        variant.price = config.price
      }
      if (config.sku) {
        variant.sku = config.sku
      }
      if (config.inventoryQuantity !== undefined) {
        variant.inventory_quantity = config.inventoryQuantity
      }
      const response = await fetch(baseUrl + 'products/' + config.productId + '/variants.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          variant: Object.keys(variant).length ? variant : config.variant || {},
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to create variant' }
      }
      return { success: true, variant: data.variant }
    }
    case 'update-inventory': {
      const response = await fetch(baseUrl + 'inventory_levels/set.json', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          location_id: config.locationId,
          inventory_item_id: config.inventoryItemId,
          available: config.available,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.errors || 'Failed to update inventory' }
      }
      return { success: true, inventoryLevel: data.inventory_level }
    }
    default:
      throw new Error('Unknown integration-shopify action: ' + action)
  }
}
export const integrationShopify: IntegrationHandlerGenerator = {
  nodeType: 'integration-shopify',
  executionEnv: 'server',
  secretFields: ['accessToken', 'storeDomain'],
  generateHandler(): string {
    return handlerToString(integration_shopify)
  },
}
