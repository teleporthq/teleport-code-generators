import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { ProductDiscounts, StorefrontTax } from '@teleporthq/teleport-shared'
import { buildWorkflowEcommerceSettingsPayload } from './ecommerce-api-routes-generator'

export const generateEcommerceContextFileContent = (
  ecommerceSettings: UIDLEcommerceSettings,
  invoiceSettings?: UIDLInvoiceSettings,
  dataSourceId?: string | null,
  // When true, the provider layers a best-effort database cart on top of
  // localStorage (sync on change, hydrate from DB when local is empty) via
  // the generated /api/cart/[op] route. Only enabled for Postgres datasources
  // — see NextEcommerceProjectPlugin.generateApiRoutes. When false the output
  // is byte-identical to the pure-localStorage cart.
  cartDbEnabled?: boolean,
  // When true, the module publishes the workflow-facing settings payload on
  // `window.__teleportEcommerceSettings` at module-eval time (this module is
  // imported by _app, so the global exists before any workflow can run). The
  // client-side `ecommerce-get-settings` workflow node reads it instead of
  // fetching /api/ecommerce/settings — the route bakes the SAME payload as a
  // literal, so the global can never disagree with it. Only the real-settings
  // branch of the project plugin turns this on; the settings-less fallback
  // context (emitted just so cart-hook imports resolve) must NOT publish a
  // defaults-shaped payload that the workflow node would mistake for real
  // merchant settings.
  emitWorkflowSettingsGlobal?: boolean
): string => {
  const settingsJson = JSON.stringify(buildSettingsObject(ecommerceSettings, invoiceSettings))
  const maxQtyLiteral = ecommerceSettings.stockManagementConfig?.maxQuantityPerProduct ?? null
  const paymentProvidersJson = JSON.stringify(ecommerceSettings.paymentProviders || [])
  const hasPaymentProviders = (ecommerceSettings.paymentProviders || []).length > 0
  // Static nested category tree for the storefront category filter, exposed as
  // `useEcommerce().ecommerceCategories` (the `E-Commerce Categories` global).
  // Each node's `name`/`description` are the main-language values; per-language
  // overrides live in `node.translations[locale]` (see
  // `resolveCategoryTranslations` below) and are resolved client-side by
  // `router.locale` — no per-locale re-fetch needed, the whole tree (every
  // language) is baked into this one JSON blob at export time.
  const ecommerceCategoriesJson = JSON.stringify(ecommerceSettings.categories || [])
  const fetchStoreLocations = ecommerceSettings.storePickupEnabled === true

  // Snapshot the delivery config at build time so the persist-cart-settings
  // useEffect can write it to localStorage without depending on the in-render
  // `settings` memo (which is declared further down — referencing it from an
  // earlier hook would hit the temporal dead zone). cart-get-total reads
  // these out of localStorage so the place-order workflow stays in sync with
  // whatever Settings → Delivery values were live at the last build.
  //
  // `deliveryEnabled` / `storePickupEnabled` ride along because a delivery fee
  // may only be charged for an order the store actually DELIVERS: the
  // place-order assemble script needs both to decide whether the buyer's
  // fulfilment choice can attract a fee at all (a pickup-only store has no
  // delivery tab to click, so its `deliveryOption` state never leaves its
  // `'delivery'` default and would otherwise be charged the stale rate).
  const deliveryConfigJson = JSON.stringify({
    deliveryEnabled: ecommerceSettings.deliveryEnabled === true,
    storePickupEnabled: ecommerceSettings.storePickupEnabled === true,
    deliveryPrice: Number(ecommerceSettings.deliveryConfig?.deliveryPrice ?? 0) || 0,
    freeDeliveryEnabled: !!ecommerceSettings.deliveryConfig?.freeDeliveryEnabled,
    freeDeliveryThreshold:
      Number(ecommerceSettings.deliveryConfig?.freeDeliveryThreshold ?? 0) || 0,
  })

  // Percentage the storefront must ADD to every stored product price, or 0.
  //
  // `teleport_products.price` is NET when the merchant picked "Added on top"
  // and already GROSS when they picked "Included in price", so exactly one of
  // the two modes changes what the shopper is quoted. Mirrors
  // `resolveStorefrontTaxRate` in the editor (teleport-gui
  // `features/e-commerce/utils/storefront-tax.ts`) — including the deliberate
  // choice NOT to gate on `invoiceSettings.enabled` (which is auto-cleared when
  // the last payment provider is removed) and the treatment of a missing
  // `taxIncludedInPrice` as "added on top", matching every other legacy-document
  // coercion of that field.
  const storefrontTaxRate = resolveStorefrontTaxRate(invoiceSettings)

  const enrichFnCode = dataSourceId
    ? [
        // Build a human-readable variant label ("Red / XL") from the product's
        // (language-resolved) variant_options axes + a variant row's option map.
        'function tqBuildVariantLabel(variantOptionsRaw, optionsMap) {',
        '  var axes = variantOptionsRaw',
        "  if (typeof axes === 'string') { try { axes = JSON.parse(axes) } catch (e) { axes = [] } }",
        '  if (!Array.isArray(axes)) return ""',
        '  var opts = optionsMap',
        "  if (typeof opts === 'string') { try { opts = JSON.parse(opts) } catch (e) { opts = {} } }",
        '  if (!opts) opts = {}',
        '  var parts = []',
        '  for (var a = 0; a < axes.length; a++) {',
        '    var axis = axes[a]',
        '    if (!axis || !axis.key) continue',
        '    var valueKey = opts[axis.key]',
        '    if (valueKey == null) continue',
        '    var label = valueKey',
        '    var values = Array.isArray(axis.values) ? axis.values : []',
        '    for (var v = 0; v < values.length; v++) { if (values[v] && values[v].value === valueKey) { label = values[v].label || valueKey; break } }',
        '    parts.push(label)',
        '  }',
        '  return parts.join(" / ")',
        '}',
        // Colour hex(es) for the selected value(s) of any COLOUR-type axis, so the
        // cart/checkout can render a colour circle next to the variant label.
        'function tqBuildVariantSwatches(variantOptionsRaw, optionsMap) {',
        '  var axes = variantOptionsRaw',
        "  if (typeof axes === 'string') { try { axes = JSON.parse(axes) } catch (e) { axes = [] } }",
        '  if (!Array.isArray(axes)) return []',
        '  var opts = optionsMap',
        "  if (typeof opts === 'string') { try { opts = JSON.parse(opts) } catch (e) { opts = {} } }",
        '  if (!opts) opts = {}',
        '  var swatches = []',
        '  for (var a = 0; a < axes.length; a++) {',
        '    var axis = axes[a]',
        "    if (!axis || !axis.key || axis.type !== 'color') continue",
        '    var valueKey = opts[axis.key]',
        '    if (valueKey == null) continue',
        '    var values = Array.isArray(axis.values) ? axis.values : []',
        '    for (var v = 0; v < values.length; v++) { if (values[v] && values[v].value === valueKey && values[v].color) { swatches.push({ color: values[v].color }); break } }',
        '  }',
        '  return swatches',
        '}',
        // Reports whether the freshly-built line differs from the stored one on
        // any field enrichment owns, so an unchanged cart can be returned by
        // reference. Compared field-by-field rather than by JSON.stringify:
        // key order is not guaranteed across engines and a false "changed"
        // would reintroduce the redundant write this exists to avoid.
        'var TQ_ENRICHED_FIELDS = ["name","price","image","variant","currency","currencySymbol","slug","originalPrice","discountType","discountValue","discountAmount"]',
        'function tqLineChanged(before, after) {',
        '  for (var f = 0; f < TQ_ENRICHED_FIELDS.length; f++) {',
        '    var key = TQ_ENRICHED_FIELDS[f]',
        '    var a = before ? before[key] : undefined',
        '    var b = after[key]',
        '    if ((a == null) !== (b == null)) return true',
        '    if (a != null && String(a) !== String(b)) return true',
        '  }',
        '  var beforeSwatches = (before && before.variantSwatches) || []',
        '  var afterSwatches = after.variantSwatches || []',
        '  if (beforeSwatches.length !== afterSwatches.length) return true',
        '  for (var sw = 0; sw < afterSwatches.length; sw++) {',
        '    if ((beforeSwatches[sw] || {}).color !== (afterSwatches[sw] || {}).color) return true',
        '  }',
        '  return false',
        '}',
        'async function enrichCartItems(items) {',
        '  if (!items || items.length === 0) return items',
        // EVERY line with a product id is re-read, not just the bare ones.
        //
        // It used to be "no name, or a variant" — enough when a line's price
        // could only go stale if the merchant edited it. A per-product discount
        // starts and expires on a schedule, so a line added at full price
        // yesterday must be re-priced today (and vice versa). Hydration is the
        // one place regenerated code can heal that, and it is a single batched
        // /api/data round trip for the whole cart either way.
        '  var needsEnrichment = items.filter(function(i) { return i.productId })',
        '  if (needsEnrichment.length === 0) return items',
        '  var productIds = [], seen = {}',
        '  for (var k = 0; k < needsEnrichment.length; k++) {',
        '    if (!seen[needsEnrichment[k].productId]) {',
        '      productIds.push(needsEnrichment[k].productId)',
        '      seen[needsEnrichment[k].productId] = true',
        '    }',
        '  }',
        '  try {',
        "    var res = await fetch('/api/data/' + PRODUCTS_DATA_SOURCE_ID + '/select', {",
        "      method: 'POST',",
        "      headers: { 'Content-Type': 'application/json' },",
        '      body: JSON.stringify({',
        "        tableName: 'teleport_products',",
        "        filters: [{ field: 'id', value: productIds, operator: '=' }],",
        '        limit: productIds.length',
        '      })',
        '    })',
        '    if (!res.ok) return items',
        '    var data = await res.json()',
        '    var rows = data.rows || []',
        '    var productMap = {}',
        '    for (var r = 0; r < rows.length; r++) { productMap[rows[r].id] = rows[r] }',
        // Fetch the purchasable variant rows for these products so variant lines
        // can show the correct price/image/label. Best-effort — a failure just
        // falls back to product-level values.
        '    var variantMap = {}',
        '    var hasVariantLines = items.some(function(i) { return i.variantId })',
        '    if (hasVariantLines) {',
        '      try {',
        "        var vres = await fetch('/api/ecommerce/variants?productIds=' + productIds.map(encodeURIComponent).join(','))",
        '        if (vres.ok) {',
        '          var vbody = await vres.json()',
        '          var vrows = (vbody && vbody.variants) || []',
        '          for (var vr = 0; vr < vrows.length; vr++) { variantMap[vrows[vr].id] = vrows[vr] }',
        '        }',
        '      } catch (ve) {}',
        '    }',
        // Whether anything actually moved. The caller persists + re-renders only
        // when the array is a NEW one, and now that EVERY line is re-read (not
        // just the bare ones) a fresh `map` would report a change on every sync
        // of an unchanged cart — one redundant localStorage write and one
        // redundant render each time. Returning the original array when nothing
        // differs keeps the old no-op contract exactly.
        '    var didChange = false',
        '    function markIfChanged(before, after) {',
        '      if (tqLineChanged(before, after)) { didChange = true }',
        '      return after',
        '    }',
        '    var enriched = items.map(function(item) {',
        '      var product = productMap[item.productId]',
        '      if (!product && item.name) return item',
        '      if (!product) return item',
        '      var variant = item.variantId ? variantMap[item.variantId] : null',
        '      var price = product.price != null ? Number(product.price) : 0',
        '      var image = product.image_url || product.imageUrl || null',
        '      var variantLabel = item.variant || ""',
        '      var variantSwatches = item.variantSwatches || []',
        '      if (variant) {',
        '        if (variant.price != null) price = Number(variant.price)',
        '        if (variant.image_url) image = variant.image_url',
        '        variantLabel = tqBuildVariantLabel(product.variant_options, variant.options)',
        '        variantSwatches = tqBuildVariantSwatches(product.variant_options, variant.options)',
        '      }',
        // The markdown live RIGHT NOW, applied to whichever net price won above
        // (the variant override, or the product base). The cart stays NET, so
        // this is the net price the shopper is charged, and the tax and every
        // total downstream are computed from it exactly as before.
        '      var discount = __pdResolveActive(product.discounts, Date.now())',
        '      var listPrice = price',
        '      price = __pdDiscountedPrice(listPrice, discount)',
        '      return markIfChanged(item, Object.assign({}, item, {',
        "        name: product.name || item.name || '',",
        '        price: price,',
        '        image: image,',
        '        variant: variantLabel,',
        '        variantSwatches: variantSwatches,',
        '        currency: product.currency || item.currency || null,',
        '        currencySymbol: product.currency_symbol || product.currencySymbol || item.currencySymbol || null,',
        '        slug: product.slug || item.slug || null,',
        // Re-stamped on every hydration, including back to null/0 once a
        // discount has expired — the placed order must record what was actually
        // given away, not what was live when the line was added.
        '        originalPrice: discount ? listPrice : null,',
        '        discountType: discount ? discount.type : null,',
        '        discountValue: discount ? discount.value : null,',
        '        discountAmount: discount ? __pdDiscountAmount(listPrice, discount) : 0',
        '      }))',
        '    })',
        '    return didChange ? enriched : items',
        '  } catch(e) { return items }',
        '}',
      ].join('\n')
    : 'function enrichCartItems(items) { return Promise.resolve(items) }'

  const dsConstCode = dataSourceId ? "const PRODUCTS_DATA_SOURCE_ID = '" + dataSourceId + "'" : ''

  // ── Database-backed cart (best-effort, optional) ──────────────────────────
  // Top-level helpers (session id + DB sync). Emitted only when cartDbEnabled.
  const cartDbHelpers = cartDbEnabled
    ? `const CART_SESSION_KEY = 'workflow_cart_session_id'

// Timestamp written by the workflow cart-clear handler when the cart is
// emptied on purpose (order placed, or the shopper hit "Clear cart"). Read by
// the DB reconcile effect below so a deliberate clear is never mistaken for a
// first-visit empty cart worth restoring. Short-lived: it only has to outlive
// the in-flight cart-sync round trip, and it must NOT suppress a legitimate
// cross-device restore on the shopper's next visit.
const CART_CLEARED_AT_KEY = 'workflow_cart_cleared_at'
const CART_CLEARED_GRACE_MS = 60000

function wasCartJustCleared() {
  if (typeof window === 'undefined') return false
  try {
    const raw = localStorage.getItem(CART_CLEARED_AT_KEY)
    if (!raw) return false
    const age = Date.now() - Number(raw)
    // A clock change (or a corrupted value) must never wedge the cart into a
    // permanently un-restorable state, so anything outside the grace window —
    // in either direction — is treated as stale and dropped.
    const fresh = isFinite(age) && age >= 0 && age < CART_CLEARED_GRACE_MS
    if (!fresh) {
      localStorage.removeItem(CART_CLEARED_AT_KEY)
    }
    return fresh
  } catch {
    return false
  }
}

// Stable per-browser guest id, used to scope a cart for users who aren't
// logged in. Logged-in carts are keyed server-side by the auth token instead.
function getOrCreateSessionId() {
  if (typeof window === 'undefined') return null
  try {
    const existing = localStorage.getItem(CART_SESSION_KEY)
    if (existing) return existing
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          const r = (Math.random() * 16) | 0
          const v = c === 'x' ? r : (r & 0x3) | 0x8
          return v.toString(16)
        })
    localStorage.setItem(CART_SESSION_KEY, id)
    return id
  } catch (e) {
    return null
  }
}

// Local state is the source of truth; the DB is a cross-session backup. This
// pushes the current cart to the server and never throws or blocks the UI.
function persistCartToDb(items) {
  if (typeof window === 'undefined') return
  try {
    const payload = (items || []).map(function (i) {
      return { productId: i.productId, variantId: i.variantId || null, quantity: i.quantity }
    })
    fetch('/api/cart/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload, sessionId: getOrCreateSessionId() }),
    }).catch(function () {})
  } catch (e) {}
}
`
    : ''

  // In-provider reconcile effect: on mount, local cart wins (and is backed up
  // to the DB); if local is empty, hydrate from the DB — unless the cart was
  // just deliberately emptied (see CART_CLEARED_AT_KEY below).
  const cartDbMountEffect = cartDbEnabled
    ? `
  const cartDbInitRef = useRef(false)
  useEffect(() => {
    if (cartDbInitRef.current) return
    cartDbInitRef.current = true
    if (typeof window === 'undefined') return
    const local = loadCartFromStorage()
    if (local && local.length > 0) {
      persistCartToDb(local)
      return
    }
    // "Empty local cart" is ambiguous: it means either "first visit on this
    // device, restore my cart" or "I just checked out / cleared the cart".
    // The workflow \`cart-clear\` handler stamps the second case and also pushes
    // the empty cart to /api/cart/sync — but that push is fire-and-forget, so a
    // post-order redirect can mount this provider before it lands. Without the
    // stamp we would then re-hydrate the cart the shopper just ordered, write
    // it back to localStorage, and the buyer lands on the confirmation page
    // with a full cart. The window only has to outlive the in-flight sync.
    if (wasCartJustCleared()) return
    try {
      fetch('/api/cart/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: getOrCreateSessionId() }),
      })
        .then(function (res) { return res.ok ? res.json() : { items: [] } })
        .then(function (data) {
          const dbItems = (data && data.items) || []
          if (!dbItems.length) return
          const mapped = dbItems.map(function (d) {
            const vid = d.variantId || null
            return {
              id: d.productId + (vid ? '__' + vid : ''),
              productId: d.productId,
              variantId: vid,
              quantity: d.quantity,
            }
          })
          setCartItems(mapped)
          setCartMeta(computeCartMeta(mapped))
          saveCartToStorage(mapped)
          enrichCartItems(mapped).then(function (enriched) {
            if (enriched !== mapped) {
              setCartItems(enriched)
              setCartMeta(computeCartMeta(enriched))
              saveCartToStorage(enriched)
            }
          })
        })
        .catch(function () {})
    } catch (e) {}
  }, [])
`
    : ''

  // In-provider debounced persist effect: mirror every cart change to the DB.
  const cartDbPersistEffect = cartDbEnabled
    ? `
  const cartPersistTimerRef = useRef(null)
  const cartPersistPrimedRef = useRef(false)
  useEffect(() => {
    if (!isHydrated) return
    // Skip the first post-hydration run: that's the initial load, already
    // reconciled above — persisting it would just echo it straight back.
    if (!cartPersistPrimedRef.current) {
      cartPersistPrimedRef.current = true
      return
    }
    // Persist every change, INCLUDING an emptied cart: after an order the
    // cart is cleared, and pushing the empty state clears the DB cart too so
    // a later visit (empty localStorage) doesn't re-hydrate a stale cart.
    if (cartPersistTimerRef.current) clearTimeout(cartPersistTimerRef.current)
    const snapshot = cartItems || []
    cartPersistTimerRef.current = setTimeout(function () {
      persistCartToDb(snapshot)
    }, 300)
    return function () {
      if (cartPersistTimerRef.current) clearTimeout(cartPersistTimerRef.current)
    }
  }, [cartItems, isHydrated])
`
    : ''

  // Workflow-facing settings global — same literal the /api/ecommerce/settings
  // route responds with. Published at module-eval time (before any render or
  // click) so the client-side `ecommerce-get-settings` workflow node resolves
  // synchronously instead of paying a server round trip per click.
  const workflowSettingsGlobalCode = emitWorkflowSettingsGlobal
    ? `
const WORKFLOW_ECOMMERCE_SETTINGS = ${JSON.stringify(
        buildWorkflowEcommerceSettingsPayload(ecommerceSettings, invoiceSettings)
      )}
if (typeof window !== 'undefined') {
  window.__teleportEcommerceSettings = WORKFLOW_ECOMMERCE_SETTINGS
}
`
    : ''

  return `import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'

const CART_STORAGE_KEY = 'workflow_cart'
const CART_SETTINGS_STORAGE_KEY = 'workflow_cart_settings'
const PICKUP_STORE_DEFAULT_KEY = 'workflow_pickup_store_default'
const VOUCHER_STORAGE_KEY = 'workflow_voucher'
${workflowSettingsGlobalCode}${dsConstCode}

const EcommerceContext = createContext(null)

function loadCartFromStorage() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

${ProductDiscounts.generateProductDiscountHelperCode()}

${enrichFnCode}

function saveCartToStorage(items) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
  } catch {}
}

${cartDbHelpers}

function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// Percentage added on top of every stored product price. Baked from the
// merchant's invoice settings at export time; \`0\` means "prices are already
// what the customer pays" (tax-inclusive pricing, or no tax configured).
const STOREFRONT_TAX_RATE = ${storefrontTaxRate}

// Gross counterpart of a stored (net) price. Cart lines are persisted to
// localStorage and to \`teleport_order_items\` at their NET price — that is the
// merchant's source of truth, and the invoice route re-derives VAT from it —
// so the tax is added HERE, at every point a price is shown or charged, and
// never written back into the stored cart. A rate change therefore re-prices
// every existing basket on the next publish, with no migration and no way to
// tax the same line twice.
function applyStorefrontTax(amount) {
  const base = Number(amount) || 0
  if (STOREFRONT_TAX_RATE <= 0) return base
  return roundMoney(base * (1 + STOREFRONT_TAX_RATE / 100))
}

// The unit price the shopper is quoted, and pays. Rounded per UNIT (not per
// line) so \`unit price × quantity\` really does equal the line total the cart
// page prints beside it.
function cartItemDisplayPrice(item) {
  return applyStorefrontTax(item && item.price)
}

// A line's quantity, defended against the shapes a cart can actually hold: the
// field arrives as a string from a hand-edited localStorage cart, and a missing
// or non-positive value has always meant "one of these".
function cartItemQuantity(item) {
  const qty = Number(item && item.quantity)
  return isFinite(qty) && qty > 0 ? qty : 1
}

// What ONE cart line costs — the gross unit price times its quantity. This is
// what the cart page prints beside the \`− qty +\` stepper and what the checkout
// summary prints under its "Total" column; summing it across the lines gives
// back exactly \`computeCartMeta\`'s subtotal, which is why both go through the
// same two helpers.
function cartItemLineTotal(item) {
  return roundMoney(cartItemDisplayPrice(item) * cartItemQuantity(item))
}

// Whether this line carries a live scheduled markdown. \`originalPrice\` is
// stamped by enrichCartItems as the NET list price the line was discounted
// from, and cleared to null the moment the discount expires — so comparing it
// with the NET price actually charged is the whole test. Number(null) is 0 and
// Number(undefined) is NaN, and neither is greater than a price, so a line that
// predates the feature reads as undiscounted.
function cartItemHasDiscount(item) {
  const original = Number(item && item.originalPrice)
  return isFinite(original) && original > Number(item && item.price)
}

// The gross line total BEFORE the markdown — the figure struck through beside
// what the shopper actually pays. Grossed and multiplied out through the same
// two steps as \`cartItemLineTotal\`, or the two numbers would not be comparable.
function cartItemOriginalLineTotal(item) {
  return roundMoney(applyStorefrontTax(item && item.originalPrice) * cartItemQuantity(item))
}

// Money reaching a bound text node is printed verbatim, so it is formatted here
// or not at all: \`40.46 * 5\` is \`202.3\`, and a price slot has to read
// \`202.30\`.
function formatCartMoney(amount) {
  const n = Number(amount)
  return (isFinite(n) ? n : 0).toFixed(2)
}

function computeCartMeta(items) {
  let total = 0
  let itemCount = 0
  for (let i = 0; i < items.length; i++) {
    total += cartItemLineTotal(items[i])
    itemCount += cartItemQuantity(items[i])
  }
  return { total: roundMoney(total), itemCount }
}

// Resolve each category's name/description to \`locale\` from its
// \`translations\` map, falling back to the main-language (top-level) fields
// when there's no override yet, or no locale is active. Recurses into
// \`children\` — every node in the tree carries its own translations.
function resolveCategoryTranslations(categories, locale) {
  if (!Array.isArray(categories) || !categories.length) return categories
  return categories.map(function (category) {
    var override = locale && category.translations ? category.translations[locale] : null
    return Object.assign({}, category, {
      name: (override && override.name) || category.name,
      description: (override && override.description) || category.description,
      children: resolveCategoryTranslations(category.children, locale),
    })
  })
}

// Mirrors \`resolveCartDelivery\` in the editor (teleport-gui
// \`features/e-commerce/utils/delivery-fee.ts\`), which is what the cart
// simulator and the canvas projection use — a difference between the two is a
// page that previews one delivery fee and charges another.
//
// \`deliveryEnabled\` gates the RATE, not just the row: a store that switched to
// pickup-only keeps whatever \`deliveryPrice\` it last saved, and quoting it
// would charge for a delivery that never happens.
function computeShippingMeta(cartTotal, deliveryConfig, deliveryEnabled) {
  const cart = roundMoney(cartTotal)
  const freeDeliveryEnabled = deliveryConfig?.freeDeliveryEnabled ?? false
  const threshold = roundMoney(deliveryConfig?.freeDeliveryThreshold ?? 0)
  const baseDeliveryPrice = deliveryEnabled ? roundMoney(deliveryConfig?.deliveryPrice ?? 0) : 0

  // Epsilon defends against IEEE-754 drift on the cart subtotal — accumulated
  // \`price * quantity\` sums can land at e.g. 4999.999999999 even after
  // \`roundMoney\`, slipping below the threshold by sub-cent amounts.
  // Half a cent is well below any currency's smallest unit, so this never
  // triggers a false free-shipping at meaningful values below the threshold.
  const shippingIsFree = deliveryConfig === null
    ? true
    : freeDeliveryEnabled && (cart + 0.005) >= threshold
  const shippingPrice = deliveryConfig === null ? 0 : (shippingIsFree ? 0 : baseDeliveryPrice)
  const totalWithShipping = roundMoney(cart + shippingPrice)
  const freeDeliveryProgress = deliveryConfig === null || threshold <= 0
    ? '100%'
    : Math.min((cart / threshold) * 100, 100) + '%'
  const freeDeliveryRemaining = deliveryConfig === null
    ? 0
    : roundMoney(Math.max(0, threshold - cart))

  return { shippingIsFree, shippingPrice, totalWithShipping, freeDeliveryProgress, freeDeliveryRemaining }
}

// The voucher the shopper applied at checkout, kept beside the cart so the
// discount survives a navigation and recomputes as they edit their basket.
//
// Anything unparseable is treated as "no voucher" rather than throwing: this
// runs during render, and a malformed value must never take the storefront
// down. The stored copy is DISPLAY only — the place-order workflow re-reads the
// voucher from the database and prices the order from that.
function loadVoucherFromStorage() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(VOUCHER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.code) return null
    return parsed
  } catch {
    return null
  }
}

// ⚠️ PAIRED with \`resolveVoucherDiscount\` in the editor (teleport-gui
// \`features/e-commerce/utils/voucher-discount.ts\`) and with the
// \`VOUCHER_DISCOUNT_HELPERS\` baked into the checkout workflows. All three
// compute the same number; a difference means the shopper is shown one
// discount and charged another.
//
// Discounts are taken on the GROSS eligible subtotal (per-unit gross rounding,
// then multiply), clamped so an order can reach zero but never go below it.
function voucherLineGross(item, taxRatePercent) {
  const net = Number(item.price) || 0
  if (taxRatePercent > 0) return roundMoney(net * (1 + taxRatePercent / 100))
  return net
}

function isVoucherLineEligible(item, voucher) {
  if (voucher.applies_to_all_products !== false) return true
  const ids = Array.isArray(voucher.product_ids) ? voucher.product_ids : []
  return ids.indexOf(String(item.productId)) !== -1
}

function computeVoucherMeta(cartItems, voucher, taxRatePercent, shippingMeta, vouchersEnabled) {
  const empty = {
    rawDiscount: 0,
    voucherApplied: 'false',
    voucherCode: '',
    voucherFreeShipping: 'false',
    voucherDiscountVisible: 'false',
  }
  // Turning the feature off must neutralise a voucher already sitting in a
  // shopper's browser, not just hide the input.
  if (!vouchersEnabled || !voucher) return empty

  const type = voucher.discount_type === 'fixed' || voucher.discount_type === 'free_shipping'
    ? voucher.discount_type
    : 'percentage'
  const code = String(voucher.code || '')

  if (type === 'free_shipping') {
    // Represented as "shipping becomes free", NOT as a goods discount — the
    // FREE badge the summary already has is the right way to show it, and
    // subtracting the waiver from rawTotal as well would double-count it.
    const waived = roundMoney(shippingMeta.shippingPrice)
    return {
      rawDiscount: 0,
      voucherApplied: 'true',
      voucherCode: code,
      voucherFreeShipping: waived > 0 ? 'true' : 'false',
      voucherDiscountVisible: 'false',
    }
  }

  let eligibleGross = 0
  for (const item of cartItems || []) {
    if (!item || !isVoucherLineEligible(item, voucher)) continue
    const qty = Math.max(0, Math.floor(Number(item.quantity) || 0))
    if (qty === 0) continue
    eligibleGross += voucherLineGross(item, taxRatePercent) * qty
  }
  eligibleGross = roundMoney(eligibleGross)
  if (eligibleGross <= 0) {
    return { ...empty, voucherApplied: 'true', voucherCode: code }
  }

  const value = Math.max(0, Number(voucher.discount_value) || 0)
  const raw = type === 'percentage' ? (eligibleGross * Math.min(value, 100)) / 100 : value
  const rawDiscount = Math.min(roundMoney(raw), eligibleGross)

  return {
    rawDiscount,
    voucherApplied: 'true',
    voucherCode: code,
    voucherFreeShipping: 'false',
    voucherDiscountVisible: rawDiscount > 0 ? 'true' : 'false',
  }
}

export const EcommerceProvider = ({ children }) => {
  const router = useRouter()
  const [cartItems, setCartItems] = useState([])
  const [cartMeta, setCartMeta] = useState({ total: 0, itemCount: 0 })
  const [isHydrated, setIsHydrated] = useState(false)
  const [storeLocations, setStoreLocations] = useState([])
  const [appliedVoucher, setAppliedVoucher] = useState(null)

  const enrichRef = useRef(false)
  useEffect(() => {
    const items = loadCartFromStorage()
    setCartItems(items)
    setCartMeta(computeCartMeta(items))
    setAppliedVoucher(loadVoucherFromStorage())
    setIsHydrated(true)
    // Enrich cart items with product details from DB if missing
    if (!enrichRef.current) {
      enrichRef.current = true
      enrichCartItems(items).then(function(enriched) {
        if (enriched !== items) {
          setCartItems(enriched)
          setCartMeta(computeCartMeta(enriched))
          saveCartToStorage(enriched)
        }
      })
    }
  }, [])

  useEffect(() => {
    const syncFromStorage = () => {
      const items = loadCartFromStorage()
      setCartItems(items)
      setCartMeta(computeCartMeta(items))
      // Enrich on sync too
      enrichCartItems(items).then(function(enriched) {
        if (enriched !== items) {
          setCartItems(enriched)
          setCartMeta(computeCartMeta(enriched))
          saveCartToStorage(enriched)
        }
      })
    }
    const onStorageChange = (e) => {
      if (e.key === CART_STORAGE_KEY) syncFromStorage()
      if (e.key === VOUCHER_STORAGE_KEY) setAppliedVoucher(loadVoucherFromStorage())
    }
    // The apply/remove voucher workflows write localStorage and fire this, so
    // the order summary updates the moment a code is accepted rather than on
    // the next unrelated render.
    const syncVoucher = () => setAppliedVoucher(loadVoucherFromStorage())
    window.addEventListener('teleport:cart-changed', syncFromStorage)
    window.addEventListener('teleport:voucher-changed', syncVoucher)
    window.addEventListener('storage', onStorageChange)
    return () => {
      window.removeEventListener('teleport:cart-changed', syncFromStorage)
      window.removeEventListener('teleport:voucher-changed', syncVoucher)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [])
${cartDbMountEffect}${cartDbPersistEffect}
${
  fetchStoreLocations
    ? `
  useEffect(() => {
    fetch('/api/ecommerce/store-locations')
      .then((res) => res.ok ? res.json() : { locations: [] })
      .then((data) => setStoreLocations(data.locations || []))
      .catch(() => setStoreLocations([]))
  }, [])
`
    : ''
}
  // First store id, used as the default pickup-location selection on the
  // checkout page. The checkout page picks this up via the
  // \`workflow_pickup_store_default\` localStorage key (the page-load
  // workflow reads it) and via \`ecommerce.defaultPickupStoreId\` directly.
  const defaultPickupStoreId = useMemo(() => {
    if (!storeLocations || storeLocations.length === 0) return ''
    const first = storeLocations[0]
    return (first && (first.id || first._id)) || ''
  }, [storeLocations])

  // Capture the PayPal order on the buyer's return from PayPal's hosted
  // checkout. PayPal redirects with \`?payment=success&token={paypalOrderId}\`
  // on the URL; without an explicit \`POST /v2/checkout/orders/{id}/capture\`
  // call, PayPal leaves the order in APPROVED state, never moves the funds,
  // and never fires \`PAYMENT.CAPTURE.COMPLETED\`. Done in EcommerceProvider
  // (rather than only in the order-details page-load workflow) so projects
  // pick up the fix without a UIDL re-export — the per-page workflow step
  // is a stronger guarantee for projects that DO re-export. The capture
  // endpoint is idempotent (PayPal returns ORDER_ALREADY_CAPTURED on a
  // second call, which our handler treats as success), so double-fire is
  // safe.
  const paypalCaptureRef = useRef(new Set())
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      var search = String(window.location.search || '')
      if (!search) return
      if (search.charAt(0) === '=') return
      // Manual parse — avoids an URLSearchParams polyfill on older runtimes.
      var paymentSuccess = false
      var paypalOrderId = ''
      var stripped = search.charAt(0) === '?' ? search.slice(1) : search
      var parts = stripped.split('&')
      for (var pi = 0; pi < parts.length; pi++) {
        var eq = parts[pi].indexOf('=')
        var k = eq >= 0 ? parts[pi].slice(0, eq) : parts[pi]
        var v = eq >= 0 ? parts[pi].slice(eq + 1) : ''
        try { k = decodeURIComponent(k) } catch (_e) {}
        try { v = decodeURIComponent(v) } catch (_e) {}
        if (k === 'payment' && v === 'success') paymentSuccess = true
        else if (k === 'token' && v) paypalOrderId = v
      }
      if (!paymentSuccess || !paypalOrderId) return
      if (paypalCaptureRef.current.has(paypalOrderId)) return
      paypalCaptureRef.current.add(paypalOrderId)
      fetch('/api/ecommerce/paypal/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: paypalOrderId }),
      }).catch(function () {
        // Capture is fire-and-forget from the buyer's perspective: PayPal
        // already sent them back with success. The webhook will retry on
        // the server side; failure here doesn't change what the buyer sees.
      })
    } catch (_e) {}
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      if (defaultPickupStoreId) {
        localStorage.setItem(PICKUP_STORE_DEFAULT_KEY, String(defaultPickupStoreId))
        // Notify any listening workflow (specifically the checkout page's
        // "default pickup store on locations loaded" handler) that the
        // default is now available. Needed because the page-load workflow
        // races the async store-locations fetch — on hard refresh the
        // localStorage key is empty when page-load fires, so we have to
        // wake the workflow up after the fetch finishes.
        window.dispatchEvent(
          new CustomEvent('workflow:custom:teleport-store-locations-loaded', {
            detail: { defaultId: String(defaultPickupStoreId) },
          })
        )
      } else {
        localStorage.removeItem(PICKUP_STORE_DEFAULT_KEY)
      }
    } catch {}
  }, [defaultPickupStoreId])

  const maxQtyPerProduct = ${maxQtyLiteral === null ? 'null' : maxQtyLiteral}

  // Persist cart settings so workflow handlers (cart-add-item,
  // cart-update-item-quantity, cart-get-total) can enforce the same cap and
  // shipping math as the React context. Those handlers run as standalone
  // localStorage mutators with no access to React context, so the only shared
  // channel is localStorage itself. We mirror BOTH the quantity cap and the
  // delivery config: cart-get-total reads deliveryConfig at runtime so the
  // place-order assemble script charges the CURRENT shipping price instead
  // of values that were baked into the workflow at last UIDL re-export.
  // The deliveryConfig literal is the build-time snapshot — same source as
  // the \`settings\` memo below — emitted up here so this hook doesn't run
  // before \`settings\` is initialised (TDZ).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(
        CART_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          maxQuantityPerProduct: maxQtyPerProduct,
          deliveryConfig: ${deliveryConfigJson},
          // Same channel, same reason as deliveryConfig: cart-get-total runs as
          // a standalone localStorage handler with no access to this context,
          // and the amount it hands to the place-order workflow has to be the
          // amount this provider just showed the buyer.
          taxConfig: { storefrontTaxRate: STOREFRONT_TAX_RATE },
        })
      )
    } catch {}
  }, [maxQtyPerProduct])

  const addToCart = useCallback((item) => {
    setCartItems((prev) => {
      const existing = prev.find(
        (i) => i.productId === item.productId && (i.variantId || '') === (item.variantId || '')
      )
      const currentQty = existing ? existing.quantity : 0
      let desiredQty = currentQty + (item.quantity || 1)
      if (maxQtyPerProduct !== null && desiredQty > maxQtyPerProduct) {
        desiredQty = maxQtyPerProduct
      }
      if (desiredQty === currentQty && existing) {
        return prev
      }
      let next
      if (existing) {
        next = prev.map((i) =>
          i.productId === item.productId && (i.variantId || '') === (item.variantId || '')
            ? { ...i, quantity: desiredQty }
            : i
        )
      } else {
        next = [
          ...prev,
          {
            id: item.id || (item.productId + '_' + Date.now()),
            productId: item.productId,
            variantId: item.variantId || null,
            quantity: desiredQty,
            price: item.price || 0,
            name: item.name || '',
            image: item.image || null,
          },
        ]
      }
      setCartMeta(computeCartMeta(next))
      saveCartToStorage(next)
      return next
    })
  }, [maxQtyPerProduct])

  const removeFromCart = useCallback((itemId) => {
    setCartItems((prev) => {
      const next = prev.filter((i) => i.id !== itemId)
      setCartMeta(computeCartMeta(next))
      saveCartToStorage(next)
      return next
    })
  }, [])

  const updateItemQuantity = useCallback((itemId, quantity) => {
    setCartItems((prev) => {
      let clampedQty = quantity
      if (maxQtyPerProduct !== null && clampedQty > maxQtyPerProduct) {
        clampedQty = maxQtyPerProduct
      }
      let next
      if (clampedQty <= 0) {
        next = prev.filter((i) => i.id !== itemId)
      } else {
        next = prev.map((i) => (i.id === itemId ? { ...i, quantity: clampedQty } : i))
      }
      setCartMeta(computeCartMeta(next))
      saveCartToStorage(next)
      return next
    })
  }, [maxQtyPerProduct])

  const clearCart = useCallback(() => {
    const next = []
    setCartItems(next)
    setCartMeta({ total: 0, itemCount: 0 })
    saveCartToStorage(next)
  }, [])

  const settings = useMemo(() => (${settingsJson}), [])
  const paymentProviders = useMemo(() => (${paymentProvidersJson}), [])
  const ecommerceCategoriesRaw = useMemo(() => (${ecommerceCategoriesJson}), [])
  const ecommerceCategories = useMemo(
    () => resolveCategoryTranslations(ecommerceCategoriesRaw, router.locale),
    [ecommerceCategoriesRaw, router.locale]
  )

  const shippingMeta = useMemo(
    () => computeShippingMeta(cartMeta.total, settings.Delivery, settings.deliveryEnabled === true),
    [cartMeta.total, settings.Delivery, settings.deliveryEnabled]
  )

  // What the cart & checkout pages bind their per-line money to. The stored
  // \`cartItems\` keep the NET unit price (they are what gets persisted and what
  // becomes \`teleport_order_items.unit_price\`); this projection is the only
  // place the tax is folded in for display, so the money a shopper reads always
  // agrees with the subtotal computed by \`computeCartMeta\`.
  //
  // \`price\` is the LINE total, not the unit price: a cart line is drawn next to
  // its own quantity stepper (and the checkout summary heads the column
  // "Total"), so the amount that belongs there is what those units cost
  // together. \`unitPrice\` keeps the per-unit figure addressable for a template
  // that wants to spell out "x each".
  // The tax rate comes from the baked \`STOREFRONT_TAX_RATE\` constant, NOT from
  // \`settings\`: that object is the merchant-facing settings projection and
  // carries no rate. Reading it there silently discounted the NET subtotal while
  // the place-order workflow discounts the GROSS one, so a tax-added-on-top
  // store quoted one saving and charged another.
  const voucherMeta = useMemo(
    () =>
      computeVoucherMeta(
        cartItems,
        appliedVoucher,
        STOREFRONT_TAX_RATE,
        shippingMeta,
        settings.vouchersEnabled === true
      ),
    [cartItems, appliedVoucher, settings.vouchersEnabled, shippingMeta]
  )

  const displayCartItems = useMemo(
    () =>
      cartItems.map((item) =>
        Object.assign({}, item, {
          unitPrice: formatCartMoney(cartItemDisplayPrice(item)),
          price: formatCartMoney(cartItemLineTotal(item)),
          // The price this line was marked down FROM. \`originalPrice\` is stored
          // NET and PER-UNIT by enrichCartItems; here it is grossed up and
          // multiplied out exactly like \`price\`, so the struck figure and the
          // charged one are the same kind of number. Shadowing the stored key
          // matches what \`price\` and \`unitPrice\` already do.
          originalPrice: cartItemHasDiscount(item)
            ? formatCartMoney(cartItemOriginalLineTotal(item))
            : '',
          // A 'true'/'false' STRING, because a rendering condition compares
          // operands as strings and a \`!= ''\` test passes for undefined.
          hasDiscount: cartItemHasDiscount(item) ? 'true' : 'false',
        })
      ),
    [cartItems]
  )

  // Derive currency symbol from the first cart item or fallback to '$'
  const cartCurrencySymbol = useMemo(() => {
    for (let ci = 0; ci < cartItems.length; ci++) {
      if (cartItems[ci].currencySymbol) return cartItems[ci].currencySymbol
      if (cartItems[ci].currency) {
        var sym = { USD: '$', EUR: '\u20ac', GBP: '\u00a3', JPY: '\u00a5' }
        return sym[cartItems[ci].currency] || cartItems[ci].currency
      }
    }
    return '$'
  }, [cartItems])

  // A free-shipping voucher waives the delivery fee, so every figure derived
  // from shipping has to use the WAIVED amount — otherwise the summary shows
  // "FREE" next to a total that still includes the fee.
  const effectiveShippingPrice =
    voucherMeta.voucherFreeShipping === 'true' ? 0 : shippingMeta.shippingPrice
  const effectiveTotal = Math.max(
    0,
    roundMoney(cartMeta.total + effectiveShippingPrice - voucherMeta.rawDiscount)
  )

  const value = useMemo(() => ({
    Cart: {
      items: displayCartItems,
      total: cartMeta.total,
      itemCount: cartMeta.itemCount,
      shippingPrice: effectiveShippingPrice,
      shippingIsFree:
        voucherMeta.voucherFreeShipping === 'true' ? true : shippingMeta.shippingIsFree,
      totalWithShipping: effectiveTotal,
      freeDeliveryProgress: shippingMeta.freeDeliveryProgress,
      freeDeliveryRemaining: shippingMeta.freeDeliveryRemaining,
      maxQuantityPerProduct: maxQtyPerProduct,
      // Aliases used by UIDL cart/checkout templates.
      //
      // Every one of these is 2-DECIMAL FORMATTED, for the same reason each cart
      // line is: a bound text node prints what it is given, verbatim. Left raw,
      // a £12.50 subtotal renders "12.5" beside per-line prices that do say
      // "12.50", and the editor canvas (which formats these through
      // \`resolveCartDerivedFieldFromSnapshot\`) disagrees with the published
      // page. Nothing computes with them — they are read only by text bindings.
      rawSubtotal: formatCartMoney(cartMeta.total),
      // Discount-inclusive and never below zero. Built from the WAIVED shipping
      // so a free-shipping voucher reduces the total exactly once.
      rawTotal: formatCartMoney(effectiveTotal),
      // What a pickup order owes: no delivery, but the discount still applies.
      rawSubtotalAfterDiscount: formatCartMoney(
        Math.max(0, roundMoney(cartMeta.total - voucherMeta.rawDiscount))
      ),
      rawShipping: formatCartMoney(effectiveShippingPrice),
      // Voucher surface. The flags are 'true'/'false' STRINGS because a
      // rendering condition cannot gate on a formatted money value.
      rawDiscount: formatCartMoney(voucherMeta.rawDiscount),
      voucherApplied: voucherMeta.voucherApplied,
      voucherCode: voucherMeta.voucherCode,
      voucherFreeShipping: voucherMeta.voucherFreeShipping,
      voucherDiscountVisible: voucherMeta.voucherDiscountVisible,
      currencySymbol: cartCurrencySymbol,
      addToCart,
      removeFromCart,
      updateItemQuantity,
      clearCart,
      isHydrated,
    },
    Settings: settings,
    paymentProviders,
    hasPaymentProviders: ${hasPaymentProviders},
    storeLocations,
    defaultPickupStoreId,
    ecommerceCategories,
  // \`voucherMeta\` and the two figures derived from it MUST be listed. Applying
  // or removing a code changes nothing else in this array — the cart items, the
  // cart meta and the shipping meta are all untouched — so without them the memo
  // returned the previous context object, the Provider's value stayed
  // reference-identical, and the summary only caught up on a page reload.
  }), [displayCartItems, cartMeta, shippingMeta, voucherMeta, effectiveShippingPrice, effectiveTotal, maxQtyPerProduct, cartCurrencySymbol, addToCart, removeFromCart, updateItemQuantity, clearCart, isHydrated, settings, paymentProviders, storeLocations, defaultPickupStoreId, ecommerceCategories])

  return (
    <EcommerceContext.Provider value={value}>
      {children}
    </EcommerceContext.Provider>
  )
}

export const useEcommerce = () => {
  const context = useContext(EcommerceContext)
  if (!context) {
    throw new Error('useEcommerce must be used within an EcommerceProvider')
  }
  return context
}

export const useCart = () => {
  const { Cart } = useEcommerce()
  return Cart
}

export const useEcommerceSettings = () => {
  const { Settings } = useEcommerce()
  return Settings
}
`
}

/**
 * Percentage the storefront adds on top of every stored product price, or `0`
 * when prices are already tax-inclusive / no rate is configured.
 *
 * The rule itself lives in `@teleporthq/teleport-shared` so the data-source
 * transform (a package this one depends ON, not the other way round) applies
 * the same gate to catalogue prices. Re-exported here because this module is
 * where the export side has always read it from: the provider bakes the result
 * into `STOREFRONT_TAX_RATE` and mirrors it into
 * `workflow_cart_settings.taxConfig`, which is where the standalone
 * `cart-get-total` handler reads it at runtime.
 */
export const resolveStorefrontTaxRate = StorefrontTax.resolveStorefrontTaxRate

function buildSettingsObject(
  ecommerceSettings: UIDLEcommerceSettings,
  invoiceSettings?: UIDLInvoiceSettings
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    cashOnDelivery: ecommerceSettings.cashOnDelivery,
    deliveryEnabled: ecommerceSettings.deliveryEnabled,
    storePickupEnabled: ecommerceSettings.storePickupEnabled,
    guestCheckout: ecommerceSettings.guestCheckout,
    stockManagement: ecommerceSettings.stockManagement,
    orderNotifications: ecommerceSettings.orderNotifications,
    // This object IS `E-commerce.Settings` on the storefront, so every flag a
    // generated page gates on has to be here. The checkout's voucher block
    // renders on `Settings.vouchersEnabled`, and the provider only reads a
    // stored voucher when it is true — omitting it hid the input on every
    // store and silently disabled the discount.
    vouchersEnabled: ecommerceSettings.vouchersEnabled === true,
  }

  if (ecommerceSettings.deliveryConfig) {
    settings.Delivery = {
      deliveryPrice: ecommerceSettings.deliveryConfig.deliveryPrice,
      freeDeliveryEnabled: ecommerceSettings.deliveryConfig.freeDeliveryEnabled,
      freeDeliveryThreshold: ecommerceSettings.deliveryConfig.freeDeliveryThreshold,
      estimatedDeliveryDays: ecommerceSettings.deliveryConfig.estimatedDeliveryDays,
      allowDeliveryNotes: ecommerceSettings.deliveryConfig.allowDeliveryNotes,
    }
  } else {
    settings.Delivery = null
  }

  if (ecommerceSettings.stockManagementConfig) {
    settings.Stock = {
      allowBackorders: ecommerceSettings.stockManagementConfig.allowBackorders,
      lowStockThreshold: ecommerceSettings.stockManagementConfig.lowStockThreshold,
      lowStockAlerts: ecommerceSettings.stockManagementConfig.lowStockAlerts,
      outOfStockVisibility: ecommerceSettings.stockManagementConfig.outOfStockVisibility,
      maxQuantityPerProduct: ecommerceSettings.stockManagementConfig.maxQuantityPerProduct ?? null,
    }
  } else {
    settings.Stock = null
  }

  if (invoiceSettings) {
    settings.Invoices = {
      enabled: invoiceSettings.enabled,
      invoicePrefix: invoiceSettings.invoicePrefix,
      defaultTaxRate: invoiceSettings.defaultTaxRate,
      taxIncludedInPrice: invoiceSettings.taxIncludedInPrice,
      showDiscount: invoiceSettings.showDiscount,
      autoGenerateOnPayment: invoiceSettings.autoGenerateOnPayment,
      Company: {
        companyName: invoiceSettings.companyDetails.companyName,
        companyAddress: invoiceSettings.companyDetails.companyAddress,
        companyCity: invoiceSettings.companyDetails.companyCity,
        companyState: invoiceSettings.companyDetails.companyState,
        companyZip: invoiceSettings.companyDetails.companyZip,
        companyCountry: invoiceSettings.companyDetails.companyCountry,
        companyVat: invoiceSettings.companyDetails.companyVat,
        companyRegNumber: invoiceSettings.companyDetails.companyRegNumber,
        companyEmail: invoiceSettings.companyDetails.companyEmail,
        companyPhone: invoiceSettings.companyDetails.companyPhone,
        companyWebsite: invoiceSettings.companyDetails.companyWebsite,
      },
    }
  } else {
    settings.Invoices = null
  }

  return settings
}
