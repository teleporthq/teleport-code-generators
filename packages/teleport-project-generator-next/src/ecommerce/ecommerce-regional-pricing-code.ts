import { UIDLEcommerceRegionalPricing, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { RegionalPricing } from '@teleporthq/teleport-shared'

/**
 * The storefront half of shipping zones + tax jurisdictions, as the source
 * fragments `ecommerce-context-generator.ts` splices into `EcommerceProvider`.
 *
 * Kept out of the context generator because it is one self-contained concern —
 * load three tables, read where the checkout is sending the order, price the
 * basket for it — and every fragment is emitted ONLY for a store that has the
 * feature. A store without it gets none of this code and prices exactly as it
 * always did.
 *
 * The arithmetic itself is `RegionalPricing.generateRegionalPricingHelperCode`,
 * shared with the `cart-get-total` workflow handler: the amount the provider
 * shows and the amount the place-order workflow charges come from one rule.
 */

/** The three user-database tables the zones, rates and tax rows live in. */
export const REGIONAL_PRICING_TABLES = {
  zones: 'teleport_shipping_zones',
  rates: 'teleport_shipping_rates',
  taxRates: 'teleport_tax_rates',
}

/**
 * The feature's baked settings when this store prices by destination, or null.
 *
 * Needs a datasource: the rows are read through `/api/data/<id>/select`, and a
 * project without one has nowhere to keep them.
 */
export const resolveRegionalPricing = (
  ecommerceSettings: UIDLEcommerceSettings,
  dataSourceId: string | null | undefined
): UIDLEcommerceRegionalPricing | null => {
  const regional = ecommerceSettings.regionalPricing
  return regional && regional.enabled === true && dataSourceId ? regional : null
}

/**
 * The store's own single-rate settings, which the quote falls back to wherever
 * no zone or tax row applies — the same values the provider prices a store
 * WITHOUT regions from.
 */
export interface RegionalPricingStoreDefaults {
  deliveryEnabled: boolean
  storePickupEnabled: boolean
  deliveryPrice: number
  freeDeliveryEnabled: boolean
  freeDeliveryThreshold: number
  defaultTaxRate: number
  defaultTaxIncluded: boolean
}

/**
 * Module-scope declarations: the shared rule, the baked lookup tables, the
 * loaders the provider's effects call, and the pure projections from a quote to
 * what the pages bind.
 */
export const generateRegionalPricingModuleCode = (
  regional: UIDLEcommerceRegionalPricing,
  store: RegionalPricingStoreDefaults
): string => `
${RegionalPricing.generateRegionalPricingHelperCode()}

// Baked at export: the store currency (rounding), the country NAME → ISO code
// table the checkout's country field is read through, and the store's own
// country for estimating shipping before an address exists.
const REGIONAL_PRICING = ${JSON.stringify({
  currency: regional.currency,
  countryCodes: regional.countryCodes,
  storeCountryCode: regional.storeCountryCode,
})}
const REGIONAL_STORE = ${JSON.stringify(store)}
const REGIONAL_PRICING_TABLES = ${JSON.stringify(REGIONAL_PRICING_TABLES)}
const SHIPPING_RATE_STORAGE_KEY = '${RegionalPricing.SHIPPING_RATE_STORAGE_KEY}'
const SHIPPING_RATE_CHANGED_EVENT = '${RegionalPricing.SHIPPING_RATE_CHANGED_EVENT}'
// Rows older than this are re-read the next time the shopper comes back to the
// tab, changes the cart or the checkout address, so a rate the merchant edits in
// the admin reaches a shopper who is already browsing.
const REGIONAL_CONFIG_MAX_AGE_MS = 5 * 60 * 1000
// A failed read is retried this soon instead — a blip should not leave the
// store on its flat fee for five minutes.
const REGIONAL_CONFIG_RETRY_MS = 15 * 1000

// All three tables, or nothing. Pricing from half a configuration — zones whose
// rates failed to load — would charge the store fee where a zone's own rates
// apply, so any failed read (including a store whose tables were never created)
// leaves the store on its single flat fee and default rate, which is what it
// displays and charges.
//
// The rows are kept exactly as the API returned them: \`cart-get-total\`
// normalizes its own copy, so it never has to trust a shape this module chose.
async function loadRegionalPricingRows() {
  try {
    const keys = Object.keys(REGIONAL_PRICING_TABLES)
    const responses = await Promise.all(
      keys.map(function (key) {
        return fetch('/api/data/' + PRODUCTS_DATA_SOURCE_ID + '/select', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableName: REGIONAL_PRICING_TABLES[key], limit: 1000 }),
        })
      })
    )
    const raw = {}
    for (let i = 0; i < keys.length; i++) {
      if (!responses[i].ok) return null
      const body = await responses[i].json()
      raw[keys[i]] = (body && body.rows) || []
    }
    return raw
  } catch (e) {
    return null
  }
}

function loadSelectedShippingRate() {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(SHIPPING_RATE_STORAGE_KEY) || null
  } catch (e) {
    return null
  }
}

function sameCheckoutDestination(a, b) {
  if (!a || !b) return a === b
  return a.countryCode === b.countryCode && a.countryName === b.countryName && a.region === b.region
}

// A cart line and its priced counterpart share a key: the line id, or its
// position for a hand-edited cart line that has none.
function regionalLineFor(quote, item, index) {
  const key = item && item.id !== undefined && item.id !== null ? String(item.id) : String(index)
  for (let i = 0; i < quote.lines.length; i++) {
    if (quote.lines[i].key === key) return quote.lines[i]
  }
  return null
}

// A line's money in the DESTINATION's tax. The struck "was" price is grossed at
// the same rate as the price beside it, or the two would not be comparable.
function regionalLinePricing(quote, item, index) {
  const line = regionalLineFor(quote, item, index)
  const hasDiscount = cartItemHasDiscount(item)
  if (!line) {
    return {
      unitPrice: cartItemDisplayPrice(item),
      lineTotal: cartItemLineTotal(item),
      originalLineTotal: hasDiscount ? cartItemOriginalLineTotal(item) : null,
    }
  }
  return {
    unitPrice: line.unitGross,
    lineTotal: line.lineGross,
    originalLineTotal: hasDiscount
      ? __rpRound(
          __rpGrossAmount(item.originalPrice, line.taxRate, line.taxIncluded, quote.taxDecimals) *
            cartItemQuantity(item),
          quote.taxDecimals
        )
      : null,
  }
}

// The lines the voucher rule prices against, already GROSS in the destination's
// tax — so the rule must be handed a rate of 0, never asked to tax them again.
function regionalVoucherItems(quote, cartItems) {
  return cartItems.map(function (item, index) {
    const line = regionalLineFor(quote, item, index)
    return line ? Object.assign({}, item, { price: line.unitGross }) : item
  })
}

// Same shape \`computeShippingMeta\` returns, so everything downstream of it —
// the voucher waiver, the totals, the free-delivery banner — is unchanged.
function regionalShippingMeta(quote) {
  return {
    shippingIsFree: quote.shippingIsFree,
    shippingPrice: quote.shippingGross,
    totalWithShipping: quote.total,
    freeDeliveryProgress: quote.freeShippingProgress + '%',
    freeDeliveryRemaining: quote.freeShippingRemaining,
  }
}

// What the checkout's shipping-method list binds. Flags are 'true'/'false'
// STRINGS because a rendering condition compares strings.
function regionalShippingOptions(quote) {
  return quote.options.map(function (option) {
    return {
      id: option.id,
      name: option.name,
      estimatedDays: option.estimatedDays,
      price: formatCartMoney(option.gross),
      isFree: option.isFree ? 'true' : 'false',
      selected: option.id === quote.selectedRateId ? 'true' : 'false',
    }
  })
}

// \`E-commerce.Settings\` as the pages read it. A cart page's free-delivery
// banner is gated on the store's flat fee and threshold; with zones those are
// the matched zone's, so the banner keeps telling the truth without the page
// being rebuilt.
function regionalSettingsView(settings, quote) {
  if (!quote.zonesActive) return settings
  return Object.assign({}, settings, {
    Delivery: Object.assign({}, settings.Delivery || {}, {
      deliveryPrice: quote.shippingBase,
      freeDeliveryEnabled: quote.freeShippingThreshold !== null,
      freeDeliveryThreshold: quote.freeShippingThreshold === null ? 0 : quote.freeShippingThreshold,
    }),
  })
}
`

/**
 * Provider-body state and effects. Declares `regionalConfig`,
 * `checkoutDestination`, `selectedShippingRateId` and the memoised
 * `regionalQuote` the render reads.
 *
 * Emitted AFTER `settings` and `cartItems` exist, because the quote reads both.
 */
export const generateRegionalPricingProviderCode = (): string => `
  const [regionalRows, setRegionalRows] = useState(null)
  const [checkoutDestination, setCheckoutDestination] = useState(null)
  const [selectedShippingRateId, setSelectedShippingRateId] = useState(null)
  const regionalConfigLoadedAtRef = useRef(0)
  const regionalConfigLoadingRef = useRef(false)

  // Rows are read the first time the cart holds something — a visitor who never
  // shops costs the database nothing — and again once they have gone stale.
  const refreshRegionalConfig = useCallback(() => {
    if (regionalConfigLoadingRef.current) return
    if (Date.now() - regionalConfigLoadedAtRef.current < REGIONAL_CONFIG_MAX_AGE_MS) return
    regionalConfigLoadingRef.current = true
    loadRegionalPricingRows().then(function (rows) {
      regionalConfigLoadingRef.current = false
      regionalConfigLoadedAtRef.current = rows
        ? Date.now()
        : Date.now() - REGIONAL_CONFIG_MAX_AGE_MS + REGIONAL_CONFIG_RETRY_MS
      // A failed re-read keeps the rows already on screen rather than
      // dropping a working configuration back to the flat fee.
      setRegionalRows((prev) => rows || prev)
    })
  }, [])
  const regionalConfig = useMemo(
    () => (regionalRows ? __rpNormalizeConfig(regionalRows) : null),
    [regionalRows]
  )

  const cartHasItems = cartItems.length > 0
  useEffect(() => {
    if (cartHasItems) refreshRegionalConfig()
  }, [cartHasItems, refreshRegionalConfig])

  // A shopper returning to a tab left open is the moment rows go stale.
  useEffect(() => {
    if (!cartHasItems || typeof window === 'undefined' || typeof document === 'undefined') return
    const onReturn = () => {
      if (document.visibilityState !== 'hidden') refreshRegionalConfig()
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [cartHasItems, refreshRegionalConfig])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setSelectedShippingRateId(loadSelectedShippingRate())
    const syncRate = () => setSelectedShippingRateId(loadSelectedShippingRate())
    const onStorage = (e) => {
      if (e.key === SHIPPING_RATE_STORAGE_KEY) syncRate()
    }
    window.addEventListener(SHIPPING_RATE_CHANGED_EVENT, syncRate)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SHIPPING_RATE_CHANGED_EVENT, syncRate)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // The address the checkout form is pricing, re-read whenever the page changes.
  // The country field is an autocomplete whose value is set from a script with
  // no event of its own, and the shipping block mounts only after its checkbox
  // re-renders the page — so input events alone would miss both, and the DOM
  // itself is watched. Reads are coalesced and cheap (a handful of lookups),
  // and state only moves when the destination actually changed.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    let timer = null
    const read = () => {
      timer = null
      const next = __rpReadCheckoutDestination(REGIONAL_PRICING.countryCodes)
      setCheckoutDestination((prev) => (sameCheckoutDestination(prev, next) ? prev : next))
    }
    const schedule = () => {
      if (timer === null) timer = setTimeout(read, 50)
    }
    read()
    document.addEventListener('input', schedule, true)
    document.addEventListener('change', schedule, true)
    document.addEventListener('click', schedule, true)
    const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(schedule) : null
    if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      if (timer !== null) clearTimeout(timer)
      document.removeEventListener('input', schedule, true)
      document.removeEventListener('change', schedule, true)
      document.removeEventListener('click', schedule, true)
      if (observer) observer.disconnect()
    }
  }, [])

  // A buyer reaching the checkout may have had the tab open for an hour.
  useEffect(() => {
    if (checkoutDestination && cartHasItems) refreshRegionalConfig()
  }, [checkoutDestination, cartHasItems, refreshRegionalConfig])

  // Priced for the address on the checkout form, or — anywhere else — for the
  // store's own country, which is where most orders ship and the only honest
  // estimate before the buyer has said otherwise.
  //
  // Always priced as a DELIVERY (for a store that delivers): the buyer's
  // delivery-or-pickup choice is page state this provider cannot see, and the
  // checkout page already swaps every shipping figure for its pickup
  // counterpart on that state. Tax does not depend on it.
  const regionalQuote = useMemo(
    () =>
      __rpQuote({
        config: regionalConfig,
        store: REGIONAL_STORE,
        items: cartItems,
        destination:
          checkoutDestination ||
          (REGIONAL_PRICING.storeCountryCode
            ? { countryCode: REGIONAL_PRICING.storeCountryCode, countryName: '', region: '' }
            : null),
        fulfillment: REGIONAL_STORE.deliveryEnabled ? 'delivery' : 'pickup',
        selectedRateId: selectedShippingRateId,
        currency: REGIONAL_PRICING.currency,
      }),
    [regionalConfig, checkoutDestination, selectedShippingRateId, cartItems]
  )

  // Mirrored beside the rest of the cart settings for \`cart-get-total\`, which
  // re-prices the basket at submit with the same rule and the same rows — the
  // amount charged is the amount shown. Merged rather than written whole: the
  // quantity cap and delivery snapshot share the key.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(CART_SETTINGS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      const current = parsed && typeof parsed === 'object' ? parsed : {}
      localStorage.setItem(
        CART_SETTINGS_STORAGE_KEY,
        JSON.stringify(
          Object.assign({}, current, {
            regional: {
              store: REGIONAL_STORE,
              currency: REGIONAL_PRICING.currency,
              countryCodes: REGIONAL_PRICING.countryCodes,
              rows: regionalRows,
            },
          })
        )
      )
    } catch (e) {}
  }, [regionalRows])
`
