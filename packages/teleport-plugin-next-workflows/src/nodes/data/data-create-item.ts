import { NodeHandlerGenerator, handlerToString } from '../types'

async function data_create_item(config: any, context: any) {
  const dataSourceId = config.dataSourceId
  const tableName = config.tableName
  const columnMappings = config.columnMappings || {}
  const baseUrl = (context && context.__baseUrl) || ''

  // An unresolved route-param sentinel (see resolveTemplateTokenString in
  // runtime-utils) in a columnMapping degrades to null so the INSERT itself
  // survives — only attribution-style columns lose their value.
  if (Array.isArray(columnMappings)) {
    for (let __mi = 0; __mi < columnMappings.length; __mi++) {
      const __m: any = columnMappings[__mi]
      if (__m && __m.value === '__TQ_UNRESOLVED_ROUTE_PARAM__') {
        __m.value = null
      }
    }
  } else if (columnMappings && typeof columnMappings === 'object') {
    const __mKeys = Object.keys(columnMappings)
    for (let __mi = 0; __mi < __mKeys.length; __mi++) {
      if ((columnMappings as any)[__mKeys[__mi]] === '__TQ_UNRESOLVED_ROUTE_PARAM__') {
        ;(columnMappings as any)[__mKeys[__mi]] = null
      }
    }
  }

  // Surface the workflow's anonymous-user UUID to the data-api so a
  // guest-checkout INSERT can recover its `user_id` from the
  // resolve-user output instead of being NULL'd by the UUID
  // coercion. We look for the conventional shape emitted by the
  // "Resolve Current User Or Guest Session" custom node — any node
  // output carrying a non-empty `anonymousUserId` field counts. The
  // data-api itself validates that the value is a real UUID before
  // substituting it into an ownership column. Without this hint the
  // guest's order lands with user_id = NULL, the page-load SQL on
  // /order-details/<order_number> cannot match it, and the buyer
  // gets redirected to home before seeing the order they paid for.
  let __anonymousUserId = ''
  if (context && typeof context === 'object') {
    const __ctxKeys = Object.keys(context)
    for (let __ki = 0; __ki < __ctxKeys.length; __ki++) {
      const __cv: any = context[__ctxKeys[__ki]]
      if (
        __cv &&
        typeof __cv === 'object' &&
        typeof __cv.anonymousUserId === 'string' &&
        __cv.anonymousUserId.length > 0
      ) {
        __anonymousUserId = __cv.anonymousUserId
        break
      }
    }
  }

  try {
    const reqBody: any = { tableName, columnMappings }
    if (__anonymousUserId) {
      reqBody.__anonymousUserId = __anonymousUserId
    }
    // Idempotent insert: when the node opts in, the data-api emits
    // `INSERT ... ON CONFLICT DO NOTHING`. Used by the "Resolve Current User"
    // custom node to re-ensure a guest's `users` row on every resolution
    // without a PK-violation error when the row already exists.
    if (config.onConflictDoNothing === true) {
      reqBody.onConflictDoNothing = true
    }
    const response = await fetch(baseUrl + '/api/data/' + dataSourceId + '/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    })

    const data = await response.json()

    if (!response.ok) {
      return { id: null, error: data.error || 'Create item failed' }
    }

    // Fire-and-forget the order-confirmation email when this insert
    // landed a row in the orders table. The
    // ecommerceSettings.orderNotificationConfig is wired through
    // /api/ecommerce/order-notification and used to be triggered
    // only from the PayPal webhook — leaving COD orders and
    // synchronous Stripe flows silent. By piggy-backing on the
    // INSERT we cover every path that writes an order without
    // requiring the AI to remember to add an explicit email-send
    // workflow node. The endpoint is a no-op when notifications
    // are not configured, so it is safe to call unconditionally.
    if (typeof tableName === 'string' && tableName === 'teleport_orders' && data && data.item) {
      const item: any = data.item

      // Best-effort: mark the buyer's active database cart as ordered. This is
      // a server-to-server call (no auth cookies), so we key by the order's
      // owner id — the real user_id when logged in, else the guest anon id.
      // Fire-and-forget: a failure must never affect the placed order.
      try {
        const __orderOwnerId = (item && item.user_id) || __anonymousUserId || ''
        if (__orderOwnerId) {
          fetch(baseUrl + '/api/cart/mark-ordered', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anonymousUserId: __orderOwnerId }),
          }).catch(function () {})
        }
      } catch (_e) {}

      // Walk the workflow context to find the cart line-items. The
      // order row carries totals + addresses but NOT the line items —
      // those live in cart-get-items output (the same shape the
      // place-order chain feeds into the per-item INSERT loop).
      // Without this the merchant sees "Items: 0" and zero detail.
      let cartItems: any[] = []
      if (context && typeof context === 'object') {
        const __keys = Object.keys(context)
        for (let __ki = 0; __ki < __keys.length; __ki++) {
          const __v: any = (context as any)[__keys[__ki]]
          if (__v && Array.isArray(__v.items) && __v.items.length > 0) {
            const sample: any = __v.items[0]
            if (
              sample &&
              typeof sample === 'object' &&
              ('price' in sample ||
                'unitPrice' in sample ||
                'productId' in sample ||
                'product_id' in sample)
            ) {
              cartItems = __v.items
              break
            }
          }
        }
      }
      // Normalise items into the shape the email endpoint can render
      // (name, quantity, unit_price, total_price). Defensive about
      // every field — different cart sources spell them differently.
      const normalisedItems = cartItems.map(function (it: any) {
        const unitPrice = Number(it.unitPrice != null ? it.unitPrice : it.price) || 0
        const quantity = parseInt(it.quantity, 10)
        const qty = isFinite(quantity) && quantity > 0 ? quantity : 1
        return {
          name: it.name || it.productName || it.product_name || 'Item',
          sku: it.sku || it.SKU || '',
          quantity: qty,
          unitPrice: Math.round(unitPrice * 100) / 100,
          totalPrice: Math.round(unitPrice * qty * 100) / 100,
        }
      })

      // Assemble a multi-line shipping address from individual columns.
      // The orders table layout varies: some merchants use a single
      // `shipping_address` column (text or JSON), others split it into
      // shipping_address1/city/state/postal_code/country. Cover both
      // — single column wins if it's a non-empty string, otherwise
      // we join the parts we can find.
      let shippingAddress = ''
      if (typeof item.shipping_address === 'string' && item.shipping_address.length > 0) {
        shippingAddress = item.shipping_address
      } else if (item.shipping_address && typeof item.shipping_address === 'object') {
        const sa: any = item.shipping_address
        shippingAddress = [
          sa.name || sa.recipient,
          sa.line1 || sa.address1 || sa.street,
          sa.line2 || sa.address2,
          [sa.city, sa.state || sa.region, sa.postal_code || sa.zip].filter(Boolean).join(', '),
          sa.country,
        ]
          .filter(function (x: any) {
            return typeof x === 'string' && x.length > 0
          })
          .join('\n')
      } else {
        shippingAddress = [
          item.shipping_name,
          item.shipping_address1 || item.shipping_line1 || item.shipping_street,
          item.shipping_address2 || item.shipping_line2,
          [
            item.shipping_city,
            item.shipping_state || item.shipping_region,
            item.shipping_postal_code || item.shipping_zip,
          ]
            .filter(Boolean)
            .join(', '),
          item.shipping_country,
        ]
          .filter(function (x: any) {
            return typeof x === 'string' && x.length > 0
          })
          .join('\n')
      }

      // Don't await — a slow email provider must not stall the
      // workflow's success response back to the buyer.
      try {
        fetch(baseUrl + '/api/ecommerce/order-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId: item.id || '',
            // orderNumber is the human-friendly identifier (e.g. ORD-1234)
            // that the merchant configures their templates around; the
            // raw UUID is only useful for support / debugging.
            orderNumber: item.order_number || item.id || '',
            customerEmail: item.billing_email || item.shipping_email || '',
            customerName: item.billing_name || item.shipping_name || '',
            totalAmount: Number(item.total_amount) || 0,
            currency: item.currency || '',
            paymentMethod: item.payment_method || item.payment_provider || '',
            fulfillmentMethod: item.fulfillment_method || item.fulfillment || '',
            shippingAddress,
            items: normalisedItems,
            orderDate: item.created_at || item.placed_at || '',
          }),
        }).catch(function () {
          /* notifications must never break checkout */
        })
      } catch (_e) {
        /* defensive */
      }
    }

    return { id: data.id || (data.item && data.item.id) || null, ...(data.item || {}) }
  } catch (err: unknown) {
    return { item: null, id: null, error: (err as Error).message }
  }
}
export const dataCreateItem: NodeHandlerGenerator = {
  nodeType: 'data-create-item',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(data_create_item)
  },
}
