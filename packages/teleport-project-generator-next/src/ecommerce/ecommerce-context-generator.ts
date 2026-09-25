import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { ProductDiscounts, StorefrontTax } from '@teleporthq/teleport-shared'
import { buildWorkflowEcommerceSettingsPayload } from './ecommerce-api-routes-generator'
import {
  generateRegionalPricingModuleCode,
  generateRegionalPricingProviderCode,
  resolveRegionalPricing,
} from './ecommerce-regional-pricing-code'
import {
  generateDiscountEngineModuleCode,
  generateDiscountChoiceProviderCode,
  generateDiscountEngineProviderCode,
  generateDiscountMetaCode,
  generateDiscountProjectionCode,
  resolveDiscountEngine,
} from './ecommerce-discount-engine-code'
import {
  generateGiftCardMetaCode,
  generateGiftCardModuleCode,
  generateGiftCardProviderCode,
  resolveGiftCards,
} from './ecommerce-gift-card-code'

/**
 * Records where this VISIT came from, so the checkout can stamp it onto the
 * order and a merchant can report revenue per campaign.
 *
 * ALWAYS emitted, unlike the database-cart helpers: attribution has nothing to
 * do with where the cart is stored, and the provider's mount effect calls this
 * unconditionally — gating it would be a ReferenceError on every
 * localStorage-only store.
 *
 * The reader half is baked into the place-order workflow by the editor
 * (features/workflows/templates/builders/ecommerce/order-attribution-script.ts).
 * ⚠️ ATTRIBUTION_KEY and the key that module reads MUST match.
 *
 * SESSION storage, not local: attribution belongs to a visit. A shopper who
 * arrives from a campaign today and returns directly next week is a direct
 * visit the second time, and localStorage would credit the campaign forever.
 *
 * Writes only when nothing is stored yet — that is what makes it FIRST touch.
 * A shopper who lands on a campaign URL, browses, and checks out three pages
 * later has a clean address bar by then, so reading the URL at checkout would
 * attribute every one of those orders to nothing.
 */
const ORDER_ATTRIBUTION_WRITER = `
const ATTRIBUTION_KEY = 'tq_attribution'

function captureOrderAttribution() {
  if (typeof window === 'undefined') return
  try {
    if (window.sessionStorage.getItem(ATTRIBUTION_KEY)) return
    const params = new URLSearchParams(window.location.search || '')
    // Capped to the column width: a 4KB UTM value is a broken link or an
    // attack, and a rejected INSERT would fail the whole checkout.
    const read = function (key) {
      const value = params.get(key)
      return value ? String(value).slice(0, 255) : null
    }
    let referrerHost = null
    try {
      if (document.referrer) {
        const parsed = new URL(document.referrer)
        // Same-origin referrers are internal navigation, not a traffic source.
        if (parsed.host && parsed.host !== window.location.host) {
          referrerHost = parsed.host.slice(0, 255)
        }
      }
    } catch (e) {
      referrerHost = null
    }
    window.sessionStorage.setItem(
      ATTRIBUTION_KEY,
      JSON.stringify({
        utm_source: read('utm_source'),
        utm_medium: read('utm_medium'),
        utm_campaign: read('utm_campaign'),
        utm_term: read('utm_term'),
        utm_content: read('utm_content'),
        // The path only: a query string can carry an email or a token, and this
        // is written into the merchant's database.
        landing_path: String(window.location.pathname || '/').slice(0, 512),
        referrer_host: referrerHost,
      })
    )
  } catch (e) {
    /* private mode, disabled storage: the order is simply unattributed */
  }
}
`

/**
 * A subscription line and a digital-only cart, as the provider reads them off
 * the lines the add-to-cart node and hydration stamp.
 *
 * ⚠️ PAIRED with the editor: `formatBillingPeriod` mirrors
 * `constants/subscriptions.ts` and `cartRecurringSummary` mirrors
 * `utils/subscriptions/recurring-cart.ts` (teleport-gui), so the canvas
 * simulator and the published checkout print the same words. The shared
 * parity table in `ecommerce-subscriptions.test.ts` pins them together.
 */
const SUBSCRIPTION_HELPERS = `
const TQ_BILLING_INTERVALS = ['day', 'week', 'month', 'year']

function tqIsRecurringProduct(product) {
  return String((product && product.payment_type) || '').trim().toLowerCase() === 'recurring'
}

// Whatever the driver spelled; anything else is a month.
function tqNormalizeBillingInterval(value) {
  const normalized = String(value == null ? '' : value).trim().toLowerCase()
  return TQ_BILLING_INTERVALS.indexOf(normalized) !== -1 ? normalized : 'month'
}

// A positive whole number of intervals; anything else is 1.
function tqNormalizeBillingIntervalCount(value) {
  const parsed = Math.floor(Number(value))
  return isFinite(parsed) && parsed >= 1 ? parsed : 1
}

// A positive whole number read off an INTEGER column; null for NULL, 0 or
// anything unreadable — "no trial".
function tqPositiveCount(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Math.floor(Number(value))
  return isFinite(parsed) && parsed > 0 ? parsed : null
}

// "month", "3 months" — the per-cycle period a recurring price is followed by.
function formatBillingPeriod(interval, intervalCount) {
  const unit = tqNormalizeBillingInterval(interval)
  const count = tqNormalizeBillingIntervalCount(intervalCount)
  return count === 1 ? unit : count + ' ' + unit + 's'
}

// The subscription in the basket. At most one: the add-to-cart node refuses a
// second, and refuses to mix it with one-time lines.
function cartRecurringLine(items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i] && __deBool(items[i].isRecurring, false)) return items[i]
  }
  return null
}

// Whether the cart buys a gift card — the flag is stamped onto every line by
// hydration and by the add-to-cart node. Such a cart is paid online and
// issued by email, and can neither be paid with a card nor discounted.
function cartHasGiftCardLine(items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i] && __deBool(items[i].isGiftCard, false)) return true
  }
  return false
}

// "Billed every month · first charge today", or with a free trial ahead of
// the first charge: "Billed every month · free for 14 days, then every month".
function cartRecurringSummary(line) {
  const period = formatBillingPeriod(line.recurringInterval, line.recurringIntervalCount)
  const trialDays = tqPositiveCount(line.trialDays)
  const start =
    trialDays === null
      ? 'first charge today'
      : 'free for ' + trialDays + (trialDays === 1 ? ' day' : ' days') + ', then every ' + period
  return 'Billed every ' + period + ' \\u00b7 ' + start
}

// Every line is delivered without a parcel — a download, or a gift card sent
// by email — and there is at least one: nothing to ship, so no delivery fee,
// no method to pick and no parcel address.
function isDigitalOnlyCart(items) {
  if (!items || items.length === 0) return false
  for (let i = 0; i < items.length; i++) {
    if (!items[i]) return false
    if (!__deBool(items[i].isDigital, false) && !__deBool(items[i].isGiftCard, false)) return false
  }
  return true
}

// A line's kind: a subscription checks out alone at quantity one, a gift card
// is issued by email once paid, a digital line is delivered from the order
// page, anything else ships. One order holds ONE kind, so the cart does too.
function tqCartLineKind(line) {
  if (__deBool(line && line.isRecurring, false)) return 'subscription'
  if (__deBool(line && line.isGiftCard, false)) return 'gift-card'
  if (__deBool(line && line.isDigital, false)) return 'digital'
  return 'physical'
}

const TQ_CART_KIND_LABELS = {
  subscription: 'Subscriptions',
  'gift-card': 'Gift cards',
  digital: 'Digital products',
  physical: 'Physical products',
}

// Why \`item\` cannot join \`items\`, or null when it can — the same verdict and
// wording the add-to-cart workflow node gives, so a custom caller of
// \`addToCart\` is told the same thing the storefront button says.
function tqCartKindRefusal(items, item) {
  const others = (items || []).filter(
    (line) =>
      !(line.productId === item.productId && (line.variantId || '') === (item.variantId || ''))
  )
  const existing = (items || []).length !== others.length
  const kind = tqCartLineKind(item)
  const oneSubscription = {
    added: false,
    reason: 'one-subscription',
    message: 'Subscriptions are checked out on their own. Finish or empty your current cart first.',
  }
  if (existing && kind === 'subscription') return oneSubscription
  if (others.length === 0) return null
  if (kind === 'subscription' || tqCartLineKind(others[0]) === 'subscription') return oneSubscription
  if (tqCartLineKind(others[0]) !== kind) {
    return {
      added: false,
      reason: 'mixed-cart',
      message:
        TQ_CART_KIND_LABELS[kind] +
        ' need a separate order. Complete your current order or remove the other items from your cart first.',
    }
  }
  return null
}

// Same shape \`computeShippingMeta\` returns, for a cart that ships nothing.
function digitalOnlyShippingMeta(goodsTotal) {
  return {
    shippingIsFree: true,
    shippingPrice: 0,
    totalWithShipping: roundMoney(goodsTotal),
    freeDeliveryProgress: '100%',
    freeDeliveryRemaining: 0,
  }
}
`

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
  emitWorkflowSettingsGlobal?: boolean,
  // When true, `utils/ecommerce/asset-urls` and the `/api/ecommerce/assets`
  // route it calls are part of this project, so cart hydration can turn a
  // product image stored as a PROJECT-ASSET ID into a URL the browser can
  // load. Off for a datasource that has no `teleport_assets` mirror to read
  // (and for the settings-less fallback context, which has no enrichment at
  // all): the stored value is then used exactly as the row holds it, which is
  // what those stores always did — their media is direct URLs.
  assetLookupEnabled?: boolean,
  // The datasource's type, which decides whether gift cards can be taken at
  // all: their balance ledger is read and debited through SQL only a Postgres
  // datasource runs (see `resolveGiftCards`). Absent for the settings-less
  // fallback context, which then takes none.
  dataSourceType?: string | null
): string => {
  const settingsJson = JSON.stringify(buildSettingsObject(ecommerceSettings, invoiceSettings))
  const maxQtyLiteral = ecommerceSettings.stockManagementConfig?.maxQuantityPerProduct ?? null
  const paymentProvidersJson = JSON.stringify(ecommerceSettings.paymentProviders || [])
  const hasPaymentProviders = (ecommerceSettings.paymentProviders || []).length > 0
  // The providers that can bill a recurring product — what a checkout page
  // offers a cart holding a subscription instead of the full list. Baked like
  // `paymentProviders`; a store exported before the capability existed reads
  // every provider as unable, so a recurring cart is offered none.
  const subscriptionPaymentProviders = (ecommerceSettings.paymentProviders || []).filter(
    (provider) => provider.supportsSubscriptions === true
  )
  const subscriptionPaymentProvidersJson = JSON.stringify(subscriptionPaymentProviders)
  // Mirrored into `workflow_cart_settings` so the checkout's page-load workflow
  // can pre-select a capable provider for a recurring cart without reaching
  // into React — the same channel `deliveryConfig` travels.
  const subscriptionsMirrorJson = JSON.stringify({
    enabled: ecommerceSettings.subscriptions?.enabled === true,
    providers: subscriptionPaymentProviders.map((provider) => provider.type),
  })
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

  // Shipping zones + tax jurisdictions. Null for a store without the feature,
  // which then gets none of the fragments below and prices exactly as before.
  const regional = resolveRegionalPricing(ecommerceSettings, dataSourceId)
  const regionalModuleCode = regional
    ? generateRegionalPricingModuleCode(regional, {
        deliveryEnabled: ecommerceSettings.deliveryEnabled === true,
        storePickupEnabled: ecommerceSettings.storePickupEnabled === true,
        deliveryPrice: Number(ecommerceSettings.deliveryConfig?.deliveryPrice ?? 0) || 0,
        freeDeliveryEnabled: !!ecommerceSettings.deliveryConfig?.freeDeliveryEnabled,
        freeDeliveryThreshold:
          Number(ecommerceSettings.deliveryConfig?.freeDeliveryThreshold ?? 0) || 0,
        defaultTaxRate: Number(invoiceSettings?.defaultTaxRate) || 0,
        defaultTaxIncluded: invoiceSettings?.taxIncludedInPrice === true,
      })
    : ''

  // The discount engine's rule feed and the gift-card tender. Each is null for
  // a store without the feature, which then gets none of that feature's
  // loaders or effects — the engine itself is always emitted (see
  // `generateDiscountProjectionCode`), pricing vouchers in legacy mode.
  const discountEngine = resolveDiscountEngine(ecommerceSettings, dataSourceId)
  const discountEngineModuleCode = discountEngine
    ? generateDiscountEngineModuleCode(discountEngine)
    : ''
  const discountEngineProviderCode = discountEngine ? generateDiscountEngineProviderCode() : ''
  const giftCards = resolveGiftCards(ecommerceSettings, dataSourceId, dataSourceType)
  const giftCardModuleCode = giftCards ? generateGiftCardModuleCode(giftCards) : ''
  const giftCardProviderCode = giftCards ? generateGiftCardProviderCode() : ''

  // Cart hydration re-reads every line off `teleport_products`, so the media it
  // stamps back onto the line is whatever that column holds — a URL for a stock
  // photo, a bare PROJECT-ASSET ID when the merchant picked an image that
  // already lived in the project. The id has to become a URL here or the cart
  // and checkout thumbnails render `<img src="<uuid>">`, which the browser
  // resolves against the site origin and 404s.
  //
  // One batched lookup per hydration pass, and none at all for a store whose
  // media is direct URLs (`loadAssetUrlMap` finds nothing to resolve and never
  // touches the network). See `utils/ecommerce/asset-urls`.
  const assetMapLines = assetLookupEnabled
    ? [
        '    var assetUrlMap = await loadAssetUrlMap(prepared.map(function(entry) { return entry.rawImage }))',
      ]
    : []
  // `resolveMediaUrl` reports anything that did not become a loadable URL as
  // ABSENT, falling back to the URL the line already carried. That is what
  // stops a lookup outage from blanking a thumbnail an earlier pass resolved,
  // and what stops a bare id from ever reaching the `<img src>`.
  const resolveImageLines = assetLookupEnabled
    ? ['      var image = resolveMediaUrl(entry.rawImage, assetUrlMap, item.image)']
    : ['      var image = entry.rawImage']

  // What the discount engine and the tax rows price a line by, re-read with
  // everything else: the product's category ids INCLUDING ancestors (a rule
  // for "Food" covers "Food › Bread"), whether it IS a gift card (never
  // discounted, never payable with one), whether it is billed on a schedule
  // (the plan the provider bills, never discounted) or delivered as a download
  // (no shipping), and — for a store with regional pricing, whose
  // weight-tiered rates are the only reader — its weight.
  const enrichedFields = [
    'name',
    'price',
    'image',
    'variant',
    'currency',
    'currencySymbol',
    'slug',
    'originalPrice',
    'discountType',
    'discountValue',
    'discountAmount',
    'isGiftCard',
    'isRecurring',
    'recurringInterval',
    'recurringIntervalCount',
    'trialDays',
    'isDigital',
    'quantity',
    ...(regional ? ['weight', 'weightUnit'] : []),
  ]
  const regionalStampLines = regional
    ? [
        '        weight: product.weight != null ? Number(product.weight) : null,',
        '        weightUnit: product.weight_unit || null,',
      ]
    : []
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
        `var TQ_ENRICHED_FIELDS = ${JSON.stringify(enrichedFields)}`,
        'function tqLineChanged(before, after) {',
        '  for (var f = 0; f < TQ_ENRICHED_FIELDS.length; f++) {',
        '    var key = TQ_ENRICHED_FIELDS[f]',
        '    var a = before ? before[key] : undefined',
        '    var b = after[key]',
        '    if ((a == null) !== (b == null)) return true',
        '    if (a != null && String(a) !== String(b)) return true',
        '  }',
        "  if (String((before && before.categoryIds) || '') !== String(after.categoryIds || '')) return true",
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
        // Each line paired with the row it was re-read from, plus the media
        // value EXACTLY as the row holds it — a URL for a stock photo, a bare
        // project-asset id when the merchant picked an image that already lived
        // in the project. Collected in one pass so the whole cart's asset ids
        // resolve in ONE lookup instead of one per line.
        '    var prepared = items.map(function(item) {',
        '      var product = productMap[item.productId]',
        '      if (!product) return { item: item, product: null, variant: null, rawImage: null }',
        '      var variant = item.variantId ? variantMap[item.variantId] : null',
        '      var rawImage = product.image_url || product.imageUrl || null',
        '      if (variant && variant.image_url) rawImage = variant.image_url',
        '      return { item: item, product: product, variant: variant, rawImage: rawImage }',
        '    })',
        ...assetMapLines,
        '    var enriched = prepared.map(function(entry) {',
        '      var item = entry.item',
        '      var product = entry.product',
        '      if (!product) return item',
        '      var variant = entry.variant',
        '      var price = product.price != null ? Number(product.price) : 0',
        ...resolveImageLines,
        '      var variantLabel = item.variant || ""',
        '      var variantSwatches = item.variantSwatches || []',
        '      if (variant) {',
        '        if (variant.price != null) price = Number(variant.price)',
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
        '        discountAmount: discount ? __pdDiscountAmount(listPrice, discount) : 0,',
        // Categories (assigned ids plus ancestors) and the gift-card flag, read
        // through the engine's own row parsers so a missing or malformed column
        // reads as "none" / "not a gift card" rather than throwing.
        '        categoryIds: __deStringArray(product.category_filter_ids || product.category_ids),',
        '        isGiftCard: __deBool(product.is_gift_card, false),',
        // The billing schedule and the delivery kind, re-stamped like the
        // markdown: a product switched to recurring (or back) re-prices on the
        // next hydration. A subscription is ONE unit — the provider bills the
        // plan, not a quantity — so a line that arrived with more (a cart merged
        // across devices, a hand-edited storage) is brought back to one here.
        '        isRecurring: tqIsRecurringProduct(product),',
        '        recurringInterval: tqIsRecurringProduct(product) ? tqNormalizeBillingInterval(product.recurring_interval) : null,',
        '        recurringIntervalCount: tqIsRecurringProduct(product) ? tqNormalizeBillingIntervalCount(product.recurring_interval_count) : null,',
        '        trialDays: tqIsRecurringProduct(product) ? tqPositiveCount(product.trial_days) : null,',
        '        isDigital: __deBool(product.is_digital, false),',
        '        quantity: tqIsRecurringProduct(product) ? 1 : item.quantity,',
        ...regionalStampLines,
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
  if (typeof window === 'undefined') return Promise.resolve(null)
  try {
    const payload = (items || []).map(function (i) {
      return { productId: i.productId, variantId: i.variantId || null, quantity: i.quantity }
    })
    // Resolves with the server's answer so the caller can react to a MERGE: on
    // the first sync after sign-in the server claims the guest cart, refuses to
    // overwrite the union with this (pre-login) snapshot, and hands back the
    // merged lines instead. Ignoring that answer would leave the tab showing
    // half the cart the database now holds.
    // The language of the page the cart was synced from: the abandoned-cart
    // reminder reads it back so the shopper is emailed in the language they
    // browsed in. Read live off the router (the page data goes stale after a
    // client-side language switch) by the shared locale module.
    var pageLocale = emailLocale.getClientLocale()
    return fetch('/api/cart/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: payload, sessionId: getOrCreateSessionId(), locale: pageLocale }),
    })
      .then(function (res) { return res.ok ? res.json() : null })
      .catch(function () { return null })
  } catch (e) {
    return Promise.resolve(null)
  }
}
`
    : ''

  // In-provider reconcile effect: on mount, local cart wins (and is backed up
  // to the DB); if local is empty, hydrate from the DB — unless the cart was
  // just deliberately emptied (see CART_CLEARED_AT_KEY below).
  const cartDbMountEffect = cartDbEnabled
    ? `
  // Applies a cart the SERVER holds to this tab: state, meta and localStorage,
  // then the async enrichment pass. One implementation, because the two callers
  // (first-visit hydrate, post-sign-in merge) must produce identical results —
  // a shopper should not be able to tell which path filled their cart.
  const applyServerCart = useCallback((dbItems) => {
    const rows = dbItems || []
    if (!rows.length) return
    const mapped = rows.map(function (d) {
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
  }, [])

  // The sync endpoint answers with the merged cart on the FIRST sync after a
  // guest signs in — it has just claimed the guest cart and refuses to let this
  // tab's pre-login snapshot overwrite the union. Anything else is a normal
  // sync with nothing to adopt.
  const adoptMergedCart = useCallback((response) => {
    if (response && response.merged) {
      applyServerCart(response.items)
    }
  }, [applyServerCart])

  const cartDbInitRef = useRef(false)
  useEffect(() => {
    if (cartDbInitRef.current) return
    cartDbInitRef.current = true
    if (typeof window === 'undefined') return
    const local = loadCartFromStorage()
    if (local && local.length > 0) {
      // The push doubles as the guest-cart claim: on the first sync after
      // sign-in the server merges the guest cart into the account's and answers
      // with the union instead of accepting this snapshot.
      persistCartToDb(local).then(adoptMergedCart)
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
          applyServerCart(data && data.items)
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
      persistCartToDb(snapshot).then(adoptMergedCart)
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

  // The last gate before a stored media value becomes an `<img src>`.
  //
  // Hydration resolves every line it can re-read, but a line whose product row
  // has since been DELETED is returned untouched — there is nothing left to
  // resolve it from — and a cart written before this resolution existed still
  // holds the bare id. Rendering that id puts `<img src="<uuid>">` on the page
  // and the browser asks the site for `/<uuid>`. Being a display projection,
  // this drops it exactly like the other fields it shadows, and nothing that is
  // stored or charged changes.
  const displayImageLine = assetLookupEnabled
    ? `
          image: isDirectAssetUrl(item.image) ? item.image : null,`
    : ''

  // Emitted alongside `assetMapLines` / `resolveImageLines`, never on its own:
  // an import of a module the project plugin did not write would fail the build
  // ("Module not found: Can't resolve './utils/ecommerce/asset-urls'").
  const assetUrlsImport = assetLookupEnabled
    ? "import { isDirectAssetUrl, loadAssetUrlMap, resolveMediaUrl } from './utils/ecommerce/asset-urls'\n"
    : ''

  // The cart sync sends the page language; the module is emitted alongside
  // the cart route (see project-plugin.ts), so it exists exactly when this
  // import does. A default import of the CommonJS module, like the workflow
  // hook's import of the runtime — a `require` in this ES module would mix
  // module systems.
  const cartLocaleImport = cartDbEnabled
    ? "import emailLocale from './utils/email/email-locale'\n"
    : ''

  // The render-time pricing of the provider, in its two shapes. Regional stores
  // price every figure from one quote for the checkout's destination; every
  // other store keeps the single-rate arithmetic it has always used.
  // A cart that ships nothing is never charged for shipping, whichever way the
  // store prices it: the single-rate arithmetic is handed no delivery config
  // (which is how it already prices a store without one), the regional quote
  // is set aside for a zero fee.
  const pricingCode = regional
    ? `${generateRegionalPricingProviderCode()}
  const shippingMeta = useMemo(
    () =>
      digitalOnly ? digitalOnlyShippingMeta(regionalQuote.goodsGross) : regionalShippingMeta(regionalQuote),
    [regionalQuote, digitalOnly]
  )
  const cartGoodsTotal = regionalQuote.goodsGross
`
    : `  const shippingMeta = useMemo(
    () =>
      computeShippingMeta(
        cartMeta.total,
        digitalOnly ? null : settings.Delivery,
        settings.deliveryEnabled === true
      ),
    [cartMeta.total, settings.Delivery, settings.deliveryEnabled, digitalOnly]
  )
  const cartGoodsTotal = cartMeta.total
`
  // The lines the discount engine prices: on a regional store already GROSS in
  // the destination's tax (so the engine is handed a rate of 0, never asked to
  // tax them again), otherwise the stored NET lines with the baked rate.
  const discountMetaCode = generateDiscountMetaCode({
    itemsExpression: regional ? 'regionalVoucherItems(regionalQuote, cartItems)' : 'cartItems',
    taxRateExpression: regional ? '0' : 'STOREFRONT_TAX_RATE',
    itemsDeps: regional ? 'cartItems, regionalQuote, ' : 'cartItems, ',
    engineEnabled: discountEngine !== null,
  })
  const giftCardMetaCode = generateGiftCardMetaCode(giftCards !== null)
  const displayCartItemsCode = regional
    ? `  // Same projection as a single-rate store's, with each line priced in the
  // destination's tax by the quote.
  const displayCartItems = useMemo(
    () =>
      cartItems.map((item, index) => {
        const pricing = regionalLinePricing(regionalQuote, item, index)
        return Object.assign({}, item, {${displayImageLine}
          unitPrice: formatCartMoney(pricing.unitPrice),
          price: formatCartMoney(pricing.lineTotal),
          originalPrice:
            pricing.originalLineTotal === null ? '' : formatCartMoney(pricing.originalLineTotal),
          hasDiscount: cartItemHasDiscount(item) ? 'true' : 'false',
          isRecurring: __deBool(item.isRecurring, false) ? 'true' : 'false',
          isDigital: __deBool(item.isDigital, false) ? 'true' : 'false',
        })
      }),
    [cartItems, regionalQuote]
  )
`
    : `  const displayCartItems = useMemo(
    () =>
      cartItems.map((item) =>
        Object.assign({}, item, {${displayImageLine}
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
          // Same convention: the cart line hides its quantity stepper for a
          // subscription (one unit, billed by the provider).
          isRecurring: __deBool(item.isRecurring, false) ? 'true' : 'false',
          isDigital: __deBool(item.isDigital, false) ? 'true' : 'false',
        })
      ),
    [cartItems]
  )
`
  const shippingOptionsExpression = regional ? 'regionalShippingOptions(regionalQuote)' : '[]'
  const shippingOptionsVisibleExpression = regional
    ? "regionalQuote.fulfillment === 'delivery' && regionalQuote.options.length > 1 ? 'true' : 'false'"
    : "'false'"
  const shippingStatusExpression = regional ? 'regionalQuote.status' : "'ok'"
  const codAvailableExpression = regional
    ? "regionalQuote.codAvailable ? 'true' : 'false'"
    : "'true'"
  const settingsExpression = regional ? 'regionalSettingsView(settings, regionalQuote)' : 'settings'
  const valueExtraDeps = regional ? 'regionalQuote, ' : ''

  return `import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
${assetUrlsImport}${cartLocaleImport}${ORDER_ATTRIBUTION_WRITER}

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
${generateDiscountProjectionCode()}
${regionalModuleCode}
${discountEngineModuleCode}
${giftCardModuleCode}
${enrichFnCode}
${SUBSCRIPTION_HELPERS}

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

export const EcommerceProvider = ({ children }) => {
  const router = useRouter()
  const [cartItems, setCartItems] = useState([])
  // The lines as of this render, for \`addToCart\` to judge a new line against
  // synchronously — a refusal has to be answered to the caller, not to the
  // state updater.
  const cartItemsRef = useRef([])
  cartItemsRef.current = cartItems
  const [cartMeta, setCartMeta] = useState({ total: 0, itemCount: 0 })
  const [isHydrated, setIsHydrated] = useState(false)
  const [storeLocations, setStoreLocations] = useState([])
  const [appliedVoucher, setAppliedVoucher] = useState(null)

  const enrichRef = useRef(false)
  useEffect(() => {
    // First-touch attribution, before anything can navigate away from the
    // landing URL. Idempotent and cheap on a revisit; the checkout reads it back
    // and stamps it onto the order.
    captureOrderAttribution()
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
      // The shopper context (\`customer\`) is the checkout page-load workflow's,
      // not this provider's: it is carried over, never wiped. Every feature
      // snapshot (regional, discounts, gift cards) IS wiped here and merged
      // back by its own effect right after — which is what makes a feature the
      // merchant turned off disappear from the mirror.
      let customer = null
      try {
        const previous = JSON.parse(localStorage.getItem(CART_SETTINGS_STORAGE_KEY) || 'null')
        if (previous && typeof previous === 'object' && previous.customer && typeof previous.customer === 'object') {
          customer = previous.customer
        }
      } catch {
        customer = null
      }
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
          // Whether a stored voucher is to be honoured at all — the same gate
          // the discount engine applies here.
          vouchersEnabled: ${ecommerceSettings.vouchersEnabled === true},
          // Whether recurring products can be sold, and by which providers:
          // the checkout's page-load workflow pre-selects the first for a
          // cart holding a subscription.
          subscriptions: ${subscriptionsMirrorJson},
          customer: customer,
        })
      )
    } catch {}
  }, [maxQtyPerProduct])

  // Answers \`{ added, reason?, message? }\` like the add-to-cart workflow node:
  // a line whose kind (subscription / digital / physical) differs from the
  // cart's, or a second subscription, is refused so one order never holds two
  // kinds of fulfilment. The kind comes from the line handed in (the product
  // row's \`payment_type\` / \`is_digital\`), never from a later fetch.
  const addToCart = useCallback((item) => {
    const refusal = tqCartKindRefusal(cartItemsRef.current, item)
    if (refusal) {
      return refusal
    }
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
  const subscriptionPaymentProviders = useMemo(() => (${subscriptionPaymentProvidersJson}), [])
  const ecommerceCategoriesRaw = useMemo(() => (${ecommerceCategoriesJson}), [])
  const ecommerceCategories = useMemo(
    () => resolveCategoryTranslations(ecommerceCategoriesRaw, router.locale),
    [ecommerceCategoriesRaw, router.locale]
  )

  // The subscription in the basket (at most one) and whether every line is a
  // download. Read BEFORE the pricing below: a digital-only cart ships nothing,
  // so its shipping is priced at zero rather than quoted and waived.
  const recurringLine = useMemo(() => cartRecurringLine(cartItems), [cartItems])
  const recurringTrial = recurringLine !== null && tqPositiveCount(recurringLine.trialDays) !== null
  const digitalOnly = useMemo(() => isDigitalOnlyCart(cartItems), [cartItems])
  const hasGiftCardLines = useMemo(() => cartHasGiftCardLine(cartItems), [cartItems])

${pricingCode}${discountEngineProviderCode}${giftCardProviderCode}${generateDiscountChoiceProviderCode()}
  // Every discount on the basket — the applied voucher and the automatic rules
  // — priced by the shared engine over the same lines the summary prints.
${discountMetaCode}
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
${displayCartItemsCode}
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

  // A free-shipping discount waives the delivery fee, so every figure derived
  // from shipping has to use the WAIVED amount — otherwise the summary shows
  // "FREE" next to a total that still includes the fee. The engine waives at
  // most the fee itself, and at most once across every rule.
  const effectiveShippingPrice = Math.max(
    0,
    roundMoney(shippingMeta.shippingPrice - discountMeta.shippingDiscount)
  )
  // What a delivered order costs, every discount taken, never below zero; and
  // what a collected one owes — no delivery, and the discounts the engine
  // applies to an order without a shipping fee (\`pickupDiscountMeta\`), which
  // is what the place-order workflow charges for it.
  const effectiveTotal = Math.max(
    0,
    roundMoney(cartGoodsTotal + effectiveShippingPrice - discountMeta.goodsDiscount)
  )
  const pickupTotal = Math.max(0, roundMoney(cartGoodsTotal - pickupDiscountMeta.goodsDiscount))
  // What a gift card pays of each of those, and what is left to charge.
${giftCardMetaCode}
  const value = useMemo(() => ({
    Cart: {
      items: displayCartItems,
      total: cartGoodsTotal,
      itemCount: cartMeta.itemCount,
      shippingPrice: effectiveShippingPrice,
      shippingIsFree: discountMeta.shippingDiscount > 0 ? true : shippingMeta.shippingIsFree,
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
      rawSubtotal: formatCartMoney(cartGoodsTotal),
      // Discount-inclusive and never below zero. Built from the WAIVED shipping
      // so a free-shipping discount reduces the total exactly once.
      rawTotal: formatCartMoney(effectiveTotal),
      // What a pickup order owes: no delivery, but the discounts still apply.
      rawSubtotalAfterDiscount: formatCartMoney(pickupTotal),
      rawShipping: formatCartMoney(effectiveShippingPrice),
      // Voucher surface. The flags are 'true'/'false' STRINGS because a
      // rendering condition cannot gate on a formatted money value.
      rawDiscount: formatCartMoney(discountMeta.rawDiscount),
      voucherApplied: discountMeta.voucherApplied,
      voucherCode: discountMeta.voucherCode,
      voucherFreeShipping: discountMeta.voucherFreeShipping,
      voucherDiscountVisible: discountMeta.voucherDiscountVisible,
      // Automatic (code-less) discounts: what they took off the goods, which
      // rules did, and whether the summary row has anything to show. A store
      // without the engine's rule feed reports none.
      automaticDiscount: formatCartMoney(discountMeta.automaticDiscount),
      automaticDiscountVisible: discountMeta.automaticDiscountVisible,
      automaticDiscountLabel: discountMeta.automaticDiscountLabel,
      // Everything taken off the goods, voucher and automatic rules together.
      discountTotal: formatCartMoney(discountMeta.goodsDiscount),
      // The sets the shopper may choose between when several discounts could
      // apply but not together (an exclusive discount alone, or the combinable
      // ones together), and whether the checkout's chooser has anything to
      // show. Each option: \`{ key, label, saving, selected }\`.
      discountOptions: formatDiscountOptions(discountMeta.discountOptions),
      discountOptionsVisible: discountMeta.discountOptionsVisible,
      // The same discount surface for a collected order, priced like its total
      // (\`pickupDiscountMeta\`): with no delivery fee to waive, a free-shipping
      // rule steps aside — an exclusive one no longer suppresses the rules and
      // voucher after it — and no voucher reads as free shipping. The checkout
      // swaps these in on its own pickup state, so the rows a pickup summary
      // prints add up to \`rawSubtotalAfterDiscount\`.
      rawDiscountPickup: formatCartMoney(pickupDiscountMeta.rawDiscount),
      voucherFreeShippingPickup: pickupDiscountMeta.voucherFreeShipping,
      voucherDiscountVisiblePickup: pickupDiscountMeta.voucherDiscountVisible,
      automaticDiscountPickup: formatCartMoney(pickupDiscountMeta.automaticDiscount),
      automaticDiscountVisiblePickup: pickupDiscountMeta.automaticDiscountVisible,
      automaticDiscountLabelPickup: pickupDiscountMeta.automaticDiscountLabel,
      discountTotalPickup: formatCartMoney(pickupDiscountMeta.goodsDiscount),
      discountOptionsPickup: formatDiscountOptions(pickupDiscountMeta.discountOptions),
      discountOptionsVisiblePickup: pickupDiscountMeta.discountOptionsVisible,
      // Gift-card tender: never subtracted from the totals above — it is how
      // part of the total gets PAID — so the amount due is its own figure, for
      // each fulfilment shape the checkout page can be in.
      giftCardApplied: giftCardMeta.giftCardApplied,
      giftCardLast4: giftCardMeta.giftCardLast4,
      giftCardAmount: giftCardMeta.giftCardAmount,
      giftCardAmountPickup: giftCardMeta.giftCardAmountPickup,
      amountDue: giftCardMeta.amountDue,
      amountDuePickup: giftCardMeta.amountDuePickup,
      // Shipping zones. A store without them always reports one delivery
      // price, nothing pending and cash on delivery allowed, so a checkout page
      // built with the shipping-method list simply never shows it.
      shippingOptions: ${shippingOptionsExpression},
      shippingOptionsVisible: ${shippingOptionsVisibleExpression},
      shippingStatus: ${shippingStatusExpression},
      codAvailable: ${codAvailableExpression},
      // Subscriptions and digital delivery. Flags are 'true'/'false' STRINGS
      // for the checkout's gates; \`recurringSummary\` is the sentence the
      // summary prints ("Billed every month · first charge today") and
      // \`recurringAmount\` what each cycle charges — the delivered total,
      // because a recurring cart takes no store pickup.
      hasRecurringLines: recurringLine ? 'true' : 'false',
      // A subscription whose first charge is a free trial: nothing for a gift
      // card to pay, so the checkout hides the card entry.
      hasRecurringTrial: recurringTrial ? 'true' : 'false',
      isDigitalOnly: digitalOnly ? 'true' : 'false',
      // A cart buying a gift card: no code and no card can apply to it, so the
      // checkout hides both entries.
      hasGiftCardLines: hasGiftCardLines ? 'true' : 'false',
      recurringSummary: recurringLine ? cartRecurringSummary(recurringLine) : '',
      recurringAmount: formatCartMoney(effectiveTotal),
      currencySymbol: cartCurrencySymbol,
      addToCart,
      removeFromCart,
      updateItemQuantity,
      clearCart,
      isHydrated,
    },
    Settings: ${settingsExpression},
    paymentProviders,
    hasPaymentProviders: ${hasPaymentProviders},
    // The providers a recurring cart is offered instead of \`paymentProviders\`.
    subscriptionPaymentProviders,
    storeLocations,
    defaultPickupStoreId,
    ecommerceCategories,
  // \`discountMeta\`, \`pickupDiscountMeta\`, \`giftCardMeta\` and the figures
  // derived from them MUST be listed. Applying or removing a code changes
  // nothing else in this array — the cart items, the cart meta and the shipping
  // meta are all untouched — so without them the memo returned the previous
  // context object, the Provider's value stayed reference-identical, and the
  // summary only caught up on a page reload.
  }), [displayCartItems, cartMeta, ${valueExtraDeps}shippingMeta, discountMeta, pickupDiscountMeta, giftCardMeta, effectiveShippingPrice, effectiveTotal, pickupTotal, recurringLine, digitalOnly, maxQtyPerProduct, cartCurrencySymbol, addToCart, removeFromCart, updateItemQuantity, clearCart, isHydrated, settings, paymentProviders, subscriptionPaymentProviders, storeLocations, defaultPickupStoreId, ecommerceCategories])

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
    // The discount engine and gift cards, by the same rule: present on the
    // Settings object the checkout page gates its rows and blocks on. Both are
    // "the UIDL carries the block" — a checkout page built with the feature —
    // so a page never shows a block its own workflows were not built with.
    discountEngineEnabled: ecommerceSettings.discountEngine?.enabled === true,
    automaticDiscountsEnabled:
      ecommerceSettings.discountEngine?.enabled === true &&
      ecommerceSettings.discountEngine.automaticDiscounts === true,
    giftCardsEnabled: ecommerceSettings.giftCards?.enabled === true,
    // Same rule again. A recurring product's buy controls are gated on
    // `subscriptionsEnabled`: a checkout built before subscriptions would
    // charge it once, so an older storefront hides them instead.
    subscriptionsEnabled: ecommerceSettings.subscriptions?.enabled === true,
    digitalProductsEnabled: ecommerceSettings.digitalProducts?.enabled === true,
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
