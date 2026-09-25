import { UIDLEcommerceDiscountEngine, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'

/**
 * The storefront half of the discount engine — vouchers with conditions,
 * stacking, and automatic (code-less) rules — as the source fragments
 * `ecommerce-context-generator.ts` splices into `EcommerceProvider`.
 *
 * Two layers, deliberately:
 *  - the ENGINE ITSELF (`generateDiscountProjectionCode`) is emitted for every
 *    store. The provider always prices vouchers through it, in `legacy` mode
 *    for a checkout built before the engine — which reproduces, to the cent,
 *    the flat voucher rule that checkout's baked place-order workflow charges.
 *    The same block carries the row parsers `enrichCartItems` stamps
 *    categories and the gift-card flag with, so those exist regardless.
 *  - the RULE FEED (`generateDiscountEngineModuleCode` +
 *    `generateDiscountEngineProviderCode`) is emitted only when the UIDL
 *    carries the `discountEngine` block: the `teleport_discounts` loader, the
 *    shopper context the checkout page-load workflow writes, and the mirror of
 *    both into `workflow_cart_settings` for `cart-get-total`.
 *
 * The arithmetic is `DiscountEngine.generateDiscountEngineHelperCode`, shared
 * with `cart-get-total` and (byte for byte) with the editor: the discount the
 * summary shows, the discount the workflow re-prices at submit and the discount
 * stored on the order come from one rule.
 */

/**
 * The feature's baked settings when this store runs the engine's rule feed, or
 * null. Needs a datasource: automatic rules are read through
 * `/api/data/<id>/select`, and a project without one has nowhere to keep them.
 */
export const resolveDiscountEngine = (
  ecommerceSettings: UIDLEcommerceSettings,
  dataSourceId: string | null | undefined
): UIDLEcommerceDiscountEngine | null => {
  const engine = ecommerceSettings.discountEngine
  return engine && engine.enabled === true && dataSourceId ? engine : null
}

/**
 * Module-scope declarations emitted for EVERY store: the shared engine and the
 * projection from its result to what the provider's totals and the pages read.
 *
 * Must sit before `enrichCartItems`, which stamps categories and the gift-card
 * flag onto every hydrated line with the `__de` row parsers.
 */
export const generateDiscountProjectionCode = (): string => `
${DiscountEngine.generateDiscountEngineHelperCode()}

// Nothing is known about the shopper until the checkout page-load workflow
// writes it: first-order rules stay off, exactly as they do at submit when the
// server cannot tell either.
const NO_DISCOUNT_CUSTOMER = { isFirstOrder: null }

// The set of discounts the shopper chose on the checkout when several could
// apply but not together, kept beside the cart; anything unreadable is "no
// choice", which the engine answers with the set that saves the most.
const DISCOUNT_CHOICE_STORAGE_KEY = '${DiscountEngine.DISCOUNT_CHOICE_STORAGE_KEY}'
const DISCOUNT_CHOICE_CHANGED_EVENT = '${DiscountEngine.DISCOUNT_CHOICE_CHANGED_EVENT}'
function loadDiscountChoiceFromStorage() {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(DISCOUNT_CHOICE_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

// A collected order carries no delivery fee, so the engine prices it with
// none: a free-shipping rule then has nothing to waive and steps aside instead
// of occupying the slot an exclusive rule takes — which is how the place-order
// workflow prices a pickup order server-side. Priced BESIDE the delivery shape,
// the way the gift-card tender already is, because the fulfilment choice lives
// on the checkout page, not here.
const NO_SHIPPING_META = { shippingPrice: 0 }

// ⚠️ PAIRED with \`resolveCartDiscounts\` in the editor (teleport-gui
// \`features/e-commerce/utils/discount-engine/discount-engine.ts\`) and with
// the \`DISCOUNT_ENGINE_HELPERS\` baked into the checkout workflows, through
// the shared \`__de\` helpers above. All three compute the same numbers; a
// difference means the shopper is shown one discount and charged another.
//
// The stored voucher copy is DISPLAY only — the place-order workflow re-reads
// the row from the database and prices the order from that. Turning the
// feature off must neutralise a voucher already sitting in a shopper's
// browser, not just hide the input, which is why \`vouchersEnabled\` gates the
// voucher here rather than in the page.
//
// \`rawDiscount\` is the VOUCHER's goods discount and \`automaticDiscount\` the
// automatic rules' — the two summary rows they feed are separate. A shipping
// waiver, from either, reaches the totals through the shipping price alone
// (see \`effectiveShippingPrice\`), so it is never also subtracted as goods.
//
// \`choice\` is the set the shopper picked when several could apply but not
// together (the checkout's "Choose your discount" list); the engine offers
// every such set back as \`discountOptions\`, which \`formatDiscountOptions\`
// turns into what a page binds.
function computeDiscountMeta(cartItems, voucher, taxRatePercent, shippingMeta, vouchersEnabled, rules, customer, legacy, choice) {
  const voucherRule = vouchersEnabled && voucher ? __deNormalizeRule(voucher, 'voucher') : null
  const result = __deResolve({
    rules: rules,
    voucher: voucherRule,
    lines: __deLinesFromCart(cartItems),
    taxRatePercent: taxRatePercent,
    shippingPrice: shippingMeta.shippingPrice,
    customer: customer,
    legacy: legacy,
    choice: choice,
  })
  const automaticNames = []
  for (let i = 0; i < result.applied.length; i++) {
    const entry = result.applied[i]
    // The label of the automatic-discount row names what that row's amount is
    // made of, so a rule that only waived shipping stays out of it.
    if (entry.source === 'automatic' && entry.goodsDiscount > 0) automaticNames.push(entry.name)
  }
  return {
    goodsDiscount: result.goodsDiscount,
    shippingDiscount: result.shippingDiscount,
    rawDiscount: result.voucherGoodsDiscount,
    automaticDiscount: result.automaticGoodsDiscount,
    automaticDiscountLabel: automaticNames.join(', '),
    automaticDiscountVisible: result.automaticGoodsDiscount > 0 ? 'true' : 'false',
    discountOptions: result.options,
    discountOptionsVisible: result.options.length > 1 ? 'true' : 'false',
    // A voucher that matched nothing is still "applied": the chip stays so the
    // shopper can remove it, while the discount row hides rather than printing
    // a zero.
    voucherApplied: voucherRule ? 'true' : 'false',
    voucherCode: voucherRule ? voucherRule.code : '',
    voucherFreeShipping: result.voucherShippingDiscount > 0 ? 'true' : 'false',
    voucherDiscountVisible: result.voucherGoodsDiscount > 0 ? 'true' : 'false',
  }
}

// The chooser's rows as a page binds them: each saving a 2-decimal STRING and
// \`selected\` a 'true'/'false' STRING, like everything else a page reads.
function formatDiscountOptions(options) {
  const rows = []
  for (let i = 0; i < options.length; i++) {
    rows.push({
      key: options[i].key,
      label: options[i].label,
      saving: formatCartMoney(options[i].saving),
      selected: options[i].selected ? 'true' : 'false',
    })
  }
  return rows
}
`

/**
 * Module-scope declarations for a store with the rule feed: the baked engine
 * settings, the automatic-rules loader and the shopper-context reader.
 */
export const generateDiscountEngineModuleCode = (engine: UIDLEcommerceDiscountEngine): string => `
// Baked at export: whether automatic (code-less) rules are loaded at all, and
// the store currency every rule's amount is in.
const DISCOUNT_ENGINE = ${JSON.stringify({
  automaticDiscounts: engine.automaticDiscounts === true,
  currency: engine.currency,
})}
const DISCOUNTS_TABLE = '${DiscountEngine.DISCOUNTS_TABLE}'
const DISCOUNTS_REFRESH_EVENT = '${DiscountEngine.DISCOUNTS_REFRESH_EVENT}'
const CUSTOMER_CHANGED_EVENT = '${DiscountEngine.CUSTOMER_CHANGED_EVENT}'
// Rules older than this are re-read the next time the shopper comes back to
// the tab or changes the cart, so a rule the merchant edits in the admin
// reaches a shopper who is already browsing.
const DISCOUNT_RULES_MAX_AGE_MS = 5 * 60 * 1000
// A failed read is retried this soon instead — a blip should not hide every
// automatic discount for five minutes.
const DISCOUNT_RULES_RETRY_MS = 15 * 1000

// The automatic rules that apply right now. The route serves this table as a
// FEED (see \`PUBLIC_FEED_TABLES\` in teleport-shared): the pricing columns of
// the rows the DATABASE calls live, so the window that decides what the
// summary may price is the server's — the same clock that re-prices the order
// at submit — and a campaign that has not launched never reaches a browser.
// The browser clock is never consulted: a rule that ends while the tab is open
// is dropped by the next read (stale rules are re-read on return to the tab,
// and at once when the place-order workflow priced the order differently).
// Null on a failed read — including a store whose table was never created — so
// the rows already on screen are kept rather than dropped.
async function loadDiscountRows() {
  if (!DISCOUNT_ENGINE.automaticDiscounts) return []
  try {
    const res = await fetch('/api/data/' + PRODUCTS_DATA_SOURCE_ID + '/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableName: DISCOUNTS_TABLE,
        filters: [{ field: 'status', value: 'active', operator: '=' }],
        // The order the engine applies rules in (\`__deCompareRules\`), which
        // every reader loads by, so a capped read keeps the same rules.
        sorts: [
          { field: 'priority', order: 'asc' },
          { field: 'name', order: 'asc' },
          { field: 'id', order: 'asc' },
        ],
        limit: ${DiscountEngine.DISCOUNT_RULES_LIMIT},
      }),
    })
    if (!res.ok) return null
    const body = await res.json()
    return body && Array.isArray(body.rows) ? body.rows : []
  } catch (e) {
    return null
  }
}

// The shopper context the checkout page-load workflow wrote beside the cart
// settings (\`{ isFirstOrder, resolvedAt }\`), or null before it has. Read
// during an effect, so anything unreadable is simply "unknown".
function loadCustomerFromCartSettings() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CART_SETTINGS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    const customer = parsed && typeof parsed === 'object' ? parsed.customer : null
    return customer && typeof customer === 'object' ? customer : null
  } catch {
    return null
  }
}

function sameDiscountCustomer(a, b) {
  if (!a || !b) return a === b
  return a.isFirstOrder === b.isFirstOrder && a.resolvedAt === b.resolvedAt
}
`

/**
 * Provider-body state and effects for a store with the rule feed. Declares
 * `discountRules` (the live automatic rules, normalized) and
 * `discountCustomerContext` (what the engine knows about the shopper), which
 * the `discountMeta` memo reads.
 *
 * Emitted AFTER `cartItems` exists and after the provider's own
 * `workflow_cart_settings` writer, whose whole-key write this MERGES into.
 */
export const generateDiscountEngineProviderCode = (): string => `
  const [discountRows, setDiscountRows] = useState(null)
  const [discountCustomer, setDiscountCustomer] = useState(null)
  const discountRowsLoadedAtRef = useRef(0)
  const discountRowsLoadingRef = useRef(false)

  // Rules are read the first time the cart holds something — a visitor who
  // never shops costs the database nothing — and again once they have gone
  // stale. \`force\` is the place-order workflow's refresh signal, sent when
  // the server priced the order differently from this summary.
  const refreshDiscountRows = useCallback((force) => {
    if (!DISCOUNT_ENGINE.automaticDiscounts) return
    if (discountRowsLoadingRef.current) return
    if (!force && Date.now() - discountRowsLoadedAtRef.current < DISCOUNT_RULES_MAX_AGE_MS) return
    discountRowsLoadingRef.current = true
    loadDiscountRows().then(function (rows) {
      discountRowsLoadingRef.current = false
      discountRowsLoadedAtRef.current = rows
        ? Date.now()
        : Date.now() - DISCOUNT_RULES_MAX_AGE_MS + DISCOUNT_RULES_RETRY_MS
      setDiscountRows((prev) => rows || prev)
    })
  }, [])

  const discountCartHasItems = cartItems.length > 0
  useEffect(() => {
    if (discountCartHasItems) refreshDiscountRows(false)
  }, [discountCartHasItems, refreshDiscountRows])

  // A shopper returning to a tab left open is the moment rules go stale.
  useEffect(() => {
    if (!discountCartHasItems || typeof window === 'undefined' || typeof document === 'undefined') return
    const onReturn = () => {
      if (document.visibilityState !== 'hidden') refreshDiscountRows(false)
    }
    document.addEventListener('visibilitychange', onReturn)
    window.addEventListener('focus', onReturn)
    return () => {
      document.removeEventListener('visibilitychange', onReturn)
      window.removeEventListener('focus', onReturn)
    }
  }, [discountCartHasItems, refreshDiscountRows])

  // The shopper context arrives from the checkout page-load workflow, which
  // announces it; the place-order workflow announces a server re-pricing the
  // same way and asks for fresh rules with it. State only moves when the
  // context actually changed, so the mirror below is not rewritten for nothing.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncCustomer = () => {
      const next = loadCustomerFromCartSettings()
      setDiscountCustomer((prev) => (sameDiscountCustomer(prev, next) ? prev : next))
    }
    const onDiscountsRefresh = () => {
      syncCustomer()
      refreshDiscountRows(true)
    }
    syncCustomer()
    window.addEventListener(CUSTOMER_CHANGED_EVENT, syncCustomer)
    window.addEventListener(DISCOUNTS_REFRESH_EVENT, onDiscountsRefresh)
    return () => {
      window.removeEventListener(CUSTOMER_CHANGED_EVENT, syncCustomer)
      window.removeEventListener(DISCOUNTS_REFRESH_EVENT, onDiscountsRefresh)
    }
  }, [refreshDiscountRows])

  const discountRules = useMemo(() => {
    if (!discountRows) return []
    const rules = []
    for (let i = 0; i < discountRows.length; i++) {
      if (!discountRows[i] || discountRows[i].status !== 'active') continue
      const rule = __deNormalizeRule(discountRows[i], 'automatic')
      if (rule) rules.push(rule)
    }
    return rules
  }, [discountRows])
  const discountCustomerContext = useMemo(
    () =>
      discountCustomer && typeof discountCustomer.isFirstOrder === 'boolean'
        ? { isFirstOrder: discountCustomer.isFirstOrder }
        : NO_DISCOUNT_CUSTOMER,
    [discountCustomer]
  )

  // Mirrored beside the rest of the cart settings for \`cart-get-total\`, which
  // re-prices the basket at submit with the same rule, the same rows and the
  // same shopper context — the amount charged is the amount shown. Merged
  // rather than written whole: the quantity cap, delivery snapshot and the
  // shopper context share the key.
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
            discounts: {
              enabled: true,
              automaticDiscounts: DISCOUNT_ENGINE.automaticDiscounts,
              rows: discountRows,
              customer: discountCustomer,
            },
          })
        )
      )
    } catch (e) {}
  }, [discountRows, discountCustomer])
`

/**
 * Provider-body state for the shopper's discount choice, emitted for every
 * store: read on mount, re-read when the checkout's "Select Discount" workflow
 * announces a change or another tab writes the key, and cleared with the cart.
 */
export const generateDiscountChoiceProviderCode = (): string => `
  const [discountChoice, setDiscountChoice] = useState('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncChoice = () => setDiscountChoice(loadDiscountChoiceFromStorage())
    const onStorage = (e) => {
      if (e.key === DISCOUNT_CHOICE_STORAGE_KEY) syncChoice()
    }
    syncChoice()
    window.addEventListener(DISCOUNT_CHOICE_CHANGED_EVENT, syncChoice)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(DISCOUNT_CHOICE_CHANGED_EVENT, syncChoice)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
`

export interface DiscountMetaCodeOptions {
  /** The cart lines the engine prices, e.g. `cartItems`. */
  itemsExpression: string
  /** The tax rate those lines still need, `0` when they are already gross. */
  taxRateExpression: string
  /** Memo deps the items expression reads, with a trailing comma. */
  itemsDeps: string
  /** Whether the rule feed is emitted, i.e. the engine runs in full. */
  engineEnabled: boolean
}

/**
 * The `discountMeta` memo the provider's totals are built from, in its two
 * shapes: over the live rules and shopper context when the rule feed exists,
 * or in `legacy` mode — no rules, no conditions — for a checkout built before
 * the engine, which is exactly what its baked place-order workflow charges.
 */
export const generateDiscountMetaCode = (options: DiscountMetaCodeOptions): string => {
  const { itemsExpression, taxRateExpression, itemsDeps, engineEnabled } = options
  // The rate comes from the baked constant or the quote, NOT from \`settings\`:
  // that object is the merchant-facing settings projection and carries no
  // rate, and reading it there once discounted a NET subtotal while the
  // place-order workflow discounted the GROSS one.
  const rulesArguments = engineEnabled
    ? 'discountRules,\n        discountCustomerContext,\n        false'
    : '[],\n        NO_DISCOUNT_CUSTOMER,\n        true'
  const engineDeps = engineEnabled ? ', discountRules, discountCustomerContext' : ''
  return `  const discountMeta = useMemo(
    () =>
      computeDiscountMeta(
        ${itemsExpression},
        appliedVoucher,
        ${taxRateExpression},
        shippingMeta,
        settings.vouchersEnabled === true,
        ${rulesArguments},
        discountChoice
      ),
    [${itemsDeps}appliedVoucher, settings.vouchersEnabled, shippingMeta${engineDeps}, discountChoice]
  )
  // The same rules over the same lines with NO delivery fee: what a collected
  // order is charged. A free-shipping rule cannot apply to it, so an exclusive
  // one does not suppress the rest — and the totals below quote the shape the
  // shopper actually chose.
  const pickupDiscountMeta = useMemo(
    () =>
      computeDiscountMeta(
        ${itemsExpression},
        appliedVoucher,
        ${taxRateExpression},
        NO_SHIPPING_META,
        settings.vouchersEnabled === true,
        ${rulesArguments},
        discountChoice
      ),
    [${itemsDeps}appliedVoucher, settings.vouchersEnabled${engineDeps}, discountChoice]
  )
`
}
