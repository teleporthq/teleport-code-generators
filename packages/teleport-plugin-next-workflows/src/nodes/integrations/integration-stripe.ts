import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_stripe(config: any, context: Record<string, unknown>) {
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
  const secretKey = config.secretKey
  const action = config.action
  const baseUrl = 'https://api.stripe.com/v1/'
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Bearer ' + secretKey,
  }

  function toFormData(obj: any, prefix?: string) {
    const parts = []
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const fullKey = prefix ? prefix + '[' + key + ']' : key
        const val = obj[key]
        if (val !== null && val !== undefined) {
          if (typeof val === 'object' && !Array.isArray(val)) {
            parts.push(toFormData(val, fullKey))
          } else {
            parts.push(encodeURIComponent(fullKey) + '=' + encodeURIComponent(val))
          }
        }
      }
    }
    return parts.join('&')
  }

  switch (action) {
    case 'create-payment-intent': {
      const params: Record<string, any> = {
        amount: config.amount,
        currency: config.currency || 'usd',
      }
      if (config.customerId) {
        params.customer = config.customerId
      }
      if (config.paymentMethod) {
        params.payment_method = config.paymentMethod
      }
      if (config.description) {
        params.description = config.description
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      if (config.automaticPaymentMethods) {
        params['automatic_payment_methods[enabled]'] = 'true'
      }
      if (config.confirm) {
        params.confirm = 'true'
      }
      if (config.returnUrl) {
        params.return_url = config.returnUrl
      }
      const response = await fetch(baseUrl + 'payment_intents', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create payment intent',
        }
      }
      return { success: true, paymentIntent: data }
    }
    case 'create-customer': {
      const params: Record<string, any> = {}
      if (config.email) {
        params.email = config.email
      }
      if (config.name) {
        params.name = config.name
      }
      if (config.phone) {
        params.phone = config.phone
      }
      if (config.description) {
        params.description = config.description
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      if (config.paymentMethod) {
        params.payment_method = config.paymentMethod
      }
      if (config.address) {
        params.address = config.address
      }
      const response = await fetch(baseUrl + 'customers', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create customer',
        }
      }
      return { success: true, customer: data }
    }
    case 'list-products': {
      let url = baseUrl + 'products'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.active !== undefined) {
        params.push('active=' + config.active)
      }
      if (config.startingAfter) {
        params.push('starting_after=' + config.startingAfter)
      }
      if (config.endingBefore) {
        params.push('ending_before=' + config.endingBefore)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list products',
        }
      }
      return { success: true, products: data.data || [], hasMore: data.has_more }
    }
    case 'confirm-payment-intent': {
      const params: Record<string, any> = {}
      if (config.paymentMethod) {
        params.payment_method = config.paymentMethod
      }
      if (config.returnUrl) {
        params.return_url = config.returnUrl
      }
      const response = await fetch(
        baseUrl + 'payment_intents/' + config.paymentIntentId + '/confirm',
        {
          method: 'POST',
          headers,
          body: toFormData(params),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to confirm payment intent',
        }
      }
      return { success: true, paymentIntent: data }
    }
    case 'cancel-payment-intent': {
      const response = await fetch(
        baseUrl + 'payment_intents/' + config.paymentIntentId + '/cancel',
        {
          method: 'POST',
          headers,
          body: toFormData({}),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to cancel payment intent',
        }
      }
      return { success: true, paymentIntent: data }
    }
    case 'get-payment-intent': {
      const response = await fetch(baseUrl + 'payment_intents/' + config.paymentIntentId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get payment intent',
        }
      }
      return { success: true, paymentIntent: data }
    }
    case 'create-charge': {
      const params: Record<string, any> = {
        amount: config.amount,
        currency: config.currency || 'usd',
      }
      if (config.customerId) {
        params.customer = config.customerId
      }
      if (config.source) {
        params.source = config.source
      }
      if (config.paymentMethod) {
        params.payment_method = config.paymentMethod
      }
      if (config.description) {
        params.description = config.description
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      const response = await fetch(baseUrl + 'charges', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create charge',
        }
      }
      return { success: true, charge: data }
    }
    case 'create-refund': {
      const params: Record<string, any> = {}
      if (config.chargeId) {
        params.charge = config.chargeId
      }
      if (config.paymentIntentId) {
        params.payment_intent = config.paymentIntentId
      }
      if (config.amount) {
        params.amount = config.amount
      }
      if (config.reason) {
        params.reason = config.reason
      }
      const response = await fetch(baseUrl + 'refunds', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create refund',
        }
      }
      return { success: true, refund: data }
    }
    case 'update-customer': {
      const params: Record<string, any> = {}
      if (config.email !== undefined) {
        params.email = config.email
      }
      if (config.name !== undefined) {
        params.name = config.name
      }
      if (config.phone !== undefined) {
        params.phone = config.phone
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      const response = await fetch(baseUrl + 'customers/' + config.customerId, {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update customer',
        }
      }
      return { success: true, customer: data }
    }
    case 'get-customer': {
      const response = await fetch(baseUrl + 'customers/' + config.customerId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get customer',
        }
      }
      return { success: true, customer: data }
    }
    case 'delete-customer': {
      const response = await fetch(baseUrl + 'customers/' + config.customerId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to delete customer',
        }
      }
      return { success: true, customer: data }
    }
    case 'list-customers': {
      let url = baseUrl + 'customers'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.startingAfter) {
        params.push('starting_after=' + config.startingAfter)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list customers',
        }
      }
      return { success: true, customers: data.data || [], hasMore: data.has_more }
    }
    case 'create-subscription': {
      const params: Record<string, any> = {
        customer: config.customerId,
        'items[0][price]': config.priceId,
      }
      if (config.defaultPaymentMethod) {
        params.default_payment_method = config.defaultPaymentMethod
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      const response = await fetch(baseUrl + 'subscriptions', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create subscription',
        }
      }
      return { success: true, subscription: data }
    }
    case 'update-subscription': {
      const params: Record<string, any> = {}
      if (config.defaultPaymentMethod) {
        params.default_payment_method = config.defaultPaymentMethod
      }
      if (config.cancelAtPeriodEnd !== undefined) {
        params.cancel_at_period_end = config.cancelAtPeriodEnd
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      const response = await fetch(baseUrl + 'subscriptions/' + config.subscriptionId, {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update subscription',
        }
      }
      return { success: true, subscription: data }
    }
    case 'cancel-subscription': {
      const params: Record<string, any> = {}
      if (config.immediately) {
        params.invoice_now = 'true'
      }
      const fetchOpts: Record<string, any> = {
        method: 'DELETE',
        headers,
      }
      const paramBody = toFormData(params)
      if (paramBody) {
        fetchOpts.body = paramBody
      }
      const response = await fetch(baseUrl + 'subscriptions/' + config.subscriptionId, fetchOpts)
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to cancel subscription',
        }
      }
      return { success: true, subscription: data }
    }
    case 'get-subscription': {
      const response = await fetch(baseUrl + 'subscriptions/' + config.subscriptionId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get subscription',
        }
      }
      return { success: true, subscription: data }
    }
    case 'list-subscriptions': {
      let url = baseUrl + 'subscriptions'
      const params = []
      if (config.customerId) {
        params.push('customer=' + config.customerId)
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list subscriptions',
        }
      }
      return { success: true, subscriptions: data.data || [], hasMore: data.has_more }
    }
    case 'create-product': {
      const params: Record<string, any> = { name: config.name }
      if (config.description) {
        params.description = config.description
      }
      if (config.metadata) {
        params.metadata = config.metadata
      }
      const response = await fetch(baseUrl + 'products', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create product',
        }
      }
      return { success: true, product: data }
    }
    case 'update-product': {
      const params: Record<string, any> = {}
      if (config.name !== undefined) {
        params.name = config.name
      }
      if (config.description !== undefined) {
        params.description = config.description
      }
      const response = await fetch(baseUrl + 'products/' + config.productId, {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to update product',
        }
      }
      return { success: true, product: data }
    }
    case 'get-product': {
      const response = await fetch(baseUrl + 'products/' + config.productId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get product',
        }
      }
      return { success: true, product: data }
    }
    case 'create-price': {
      const params: Record<string, any> = {
        product: config.productId,
        unit_amount: config.unitAmount,
        currency: config.currency || 'usd',
      }
      if (config.recurring) {
        params.recurring = config.recurring
      }
      const response = await fetch(baseUrl + 'prices', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create price',
        }
      }
      return { success: true, price: data }
    }
    case 'create-invoice': {
      const params: Record<string, any> = { customer: config.customerId }
      if (config.collectionMethod) {
        params.collection_method = config.collectionMethod
      }
      if (config.daysUntilDue) {
        params.days_until_due = config.daysUntilDue
      }
      const response = await fetch(baseUrl + 'invoices', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create invoice',
        }
      }
      return { success: true, invoice: data }
    }
    case 'finalize-invoice': {
      const response = await fetch(baseUrl + 'invoices/' + config.invoiceId + '/finalize', {
        method: 'POST',
        headers,
        body: toFormData({}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to finalize invoice',
        }
      }
      return { success: true, invoice: data }
    }
    case 'pay-invoice': {
      const response = await fetch(baseUrl + 'invoices/' + config.invoiceId + '/pay', {
        method: 'POST',
        headers,
        body: toFormData({}),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to pay invoice',
        }
      }
      return { success: true, invoice: data }
    }
    case 'get-invoice': {
      const response = await fetch(baseUrl + 'invoices/' + config.invoiceId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to get invoice',
        }
      }
      return { success: true, invoice: data }
    }
    case 'list-invoices': {
      let url = baseUrl + 'invoices'
      const params = []
      if (config.customerId) {
        params.push('customer=' + config.customerId)
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list invoices',
        }
      }
      return { success: true, invoices: data.data || [], hasMore: data.has_more }
    }
    case 'create-payment-method': {
      const params: Record<string, any> = {
        type: config.type || 'card',
      }
      if (config.card) {
        params.card = config.card
      }
      const response = await fetch(baseUrl + 'payment_methods', {
        method: 'POST',
        headers,
        body: toFormData(params),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to create payment method',
        }
      }
      return { success: true, paymentMethod: data }
    }
    case 'attach-payment-method': {
      const response = await fetch(
        baseUrl + 'payment_methods/' + config.paymentMethodId + '/attach',
        {
          method: 'POST',
          headers,
          body: toFormData({ customer: config.customerId }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to attach payment method',
        }
      }
      return { success: true, paymentMethod: data }
    }
    case 'detach-payment-method': {
      const response = await fetch(
        baseUrl + 'payment_methods/' + config.paymentMethodId + '/detach',
        {
          method: 'POST',
          headers,
          body: toFormData({}),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to detach payment method',
        }
      }
      return { success: true, paymentMethod: data }
    }
    case 'list-payment-methods': {
      let url = baseUrl + 'payment_methods'
      const params = []
      params.push('customer=' + config.customerId)
      params.push('type=card')
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      url = url + '?' + params.join('&')
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + secretKey },
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data.error && data.error.message) || 'Failed to list payment methods',
        }
      }
      return { success: true, paymentMethods: data.data || [], hasMore: data.has_more }
    }
    default:
      throw new Error('Unknown integration-stripe action: ' + action)
  }
}
export const integrationStripe: IntegrationHandlerGenerator = {
  nodeType: 'integration-stripe',
  executionEnv: 'server',
  secretFields: ['secretKey'],
  generateHandler(): string {
    return handlerToString(integration_stripe)
  },
}
