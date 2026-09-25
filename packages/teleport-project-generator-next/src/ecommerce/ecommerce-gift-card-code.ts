import { UIDLEcommerceGiftCards, UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'
import { isPostgresCartDataSource } from './ecommerce-api-routes-generator'

/**
 * The storefront half of gift cards redeemed at checkout as a TENDER, as the
 * source fragments `ecommerce-context-generator.ts` splices into
 * `EcommerceProvider`.
 *
 * The provider never reads a gift card from the database. The Apply Gift Card
 * workflow (server-side data nodes, the only lookup) leaves what the shopper
 * may see — `{ id, last4, balance, currency, checkedAt }` — in localStorage,
 * and this code only displays how much of the order that balance would pay.
 * The place-order workflow re-reads the row and debits it; nothing here is
 * trusted for money.
 *
 * A tender is never a discount: the order total is unchanged, and the six
 * `Cart` keys this feeds (`giftCardApplied`, `giftCardLast4`, `giftCardAmount`,
 * `giftCardAmountPickup`, `amountDue`, `amountDuePickup`) exist on every store
 * so a page can bind them regardless — a store without the feature reports no
 * card and an amount due equal to the total.
 */

/**
 * The feature's baked settings when this store takes gift cards, or null.
 *
 * Needs a Postgres datasource: balances live in the store's own ledger tables,
 * which the Apply Gift Card and place-order workflows read and debit through
 * SQL only that family of datasources can run.
 */
export const resolveGiftCards = (
  ecommerceSettings: UIDLEcommerceSettings,
  dataSourceId: string | null | undefined,
  dataSourceType: string | null | undefined
): UIDLEcommerceGiftCards | null => {
  const giftCards = ecommerceSettings.giftCards
  return giftCards &&
    giftCards.enabled === true &&
    dataSourceId &&
    isPostgresCartDataSource(dataSourceType || null)
    ? giftCards
    : null
}

/**
 * Module-scope declarations: the baked currency, the storage contract shared
 * with the checkout workflows, and the projection from a stored card to what
 * the summary rows bind.
 */
export const generateGiftCardModuleCode = (giftCards: UIDLEcommerceGiftCards): string => `
// Baked at export: a card is only ever redeemed in the store's own currency,
// and pays part of a subscription's first charge only on a checkout whose
// place-order workflow hands the provider the reduced charge.
const GIFT_CARDS = ${JSON.stringify({
  currency: giftCards.currency,
  recurringTender: giftCards.recurringTender === true,
})}
const GIFT_CARD_STORAGE_KEY = '${DiscountEngine.GIFT_CARD_STORAGE_KEY}'
const GIFT_CARD_CHANGED_EVENT = '${DiscountEngine.GIFT_CARD_CHANGED_EVENT}'

// The gift card the shopper applied at checkout, as the Apply Gift Card
// workflow left it. Anything unparseable, and a card in another currency, is
// "no card" rather than an exception: this runs in an effect, and a malformed
// value must never take the storefront down. \`balance\` is what the workflow
// saw when it checked the card — the place-order workflow re-reads it.
function loadGiftCardFromStorage() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(GIFT_CARD_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null
    if (String(parsed.currency || '').toUpperCase() !== GIFT_CARDS.currency.toUpperCase()) return null
    const balance = Number(parsed.balance)
    return {
      id: String(parsed.id),
      last4: String(parsed.last4 || ''),
      balance: isFinite(balance) && balance > 0 ? balance : 0,
      currency: GIFT_CARDS.currency,
      checkedAt: parsed.checkedAt || null,
    }
  } catch {
    return null
  }
}

// A cart that buys a gift card cannot be paid with one — the flag is stamped
// onto every line by hydration and by the add-to-cart node.
function cartHasGiftCardLines(items) {
  for (let i = 0; i < items.length; i++) {
    if (items[i] && __deBool(items[i].isGiftCard, false)) return true
  }
  return false
}

// How much of each order shape the card pays, through the shared tender rule
// (\`__deTender\`, the same one the place-order workflow debits with): the
// balance, capped at the total, and never leaving a remainder the payment
// provider would refuse to charge. Both fulfilment totals are priced because
// the delivery-or-pickup choice is page state this provider cannot see; the
// checkout page swaps the figures on that state.
//
// Every amount is a 2-decimal STRING and the flag a 'true'/'false' STRING,
// like everything else a page binds.
// A recurring cart is billed by the provider every cycle: the card pays part
// of the FIRST charge only, never all of it, and nothing of a first charge
// that is a free trial — the same rule the place-order workflow's tender
// applies.
function computeGiftCardMeta(card, deliveryTotal, pickupTotal, hasGiftCardLines, hasRecurringLines, hasRecurringTrial) {
  const balance = card ? card.balance : 0
  const delivery = __deTender({
    balance: balance,
    total: deliveryTotal,
    currency: GIFT_CARDS.currency,
    hasGiftCardLines: hasGiftCardLines,
    hasRecurringLines: hasRecurringLines === true,
    recurringTenderAllowed: GIFT_CARDS.recurringTender === true,
    hasRecurringTrial: hasRecurringTrial === true,
  })
  const pickup = __deTender({
    balance: balance,
    total: pickupTotal,
    currency: GIFT_CARDS.currency,
    hasGiftCardLines: hasGiftCardLines,
    hasRecurringLines: hasRecurringLines === true,
    recurringTenderAllowed: GIFT_CARDS.recurringTender === true,
    hasRecurringTrial: hasRecurringTrial === true,
  })
  return {
    // A stored card that pays nothing (no balance, an empty cart, a gift card
    // in the basket) is shown as not applied: the entry block returns and the
    // tender rows hide, and \`cart-get-total\` reports the same.
    giftCardApplied: card !== null && delivery.applied > 0 ? 'true' : 'false',
    giftCardLast4: card !== null ? card.last4 : '',
    giftCardAmount: formatCartMoney(delivery.applied),
    giftCardAmountPickup: formatCartMoney(pickup.applied),
    amountDue: formatCartMoney(delivery.amountDue),
    amountDuePickup: formatCartMoney(pickup.amountDue),
  }
}
`

/**
 * Provider-body state and effects: the applied card, re-read on the checkout
 * workflows' signal and on another tab's change, and the feature's mirror into
 * `workflow_cart_settings` for `cart-get-total`.
 *
 * Emitted after the provider's own `workflow_cart_settings` writer, whose
 * whole-key write this MERGES into.
 */
export const generateGiftCardProviderCode = (): string => `
  const [appliedGiftCard, setAppliedGiftCard] = useState(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const syncGiftCard = () => setAppliedGiftCard(loadGiftCardFromStorage())
    const onGiftCardStorage = (e) => {
      if (e.key === GIFT_CARD_STORAGE_KEY) syncGiftCard()
    }
    syncGiftCard()
    window.addEventListener(GIFT_CARD_CHANGED_EVENT, syncGiftCard)
    window.addEventListener('storage', onGiftCardStorage)
    return () => {
      window.removeEventListener(GIFT_CARD_CHANGED_EVENT, syncGiftCard)
      window.removeEventListener('storage', onGiftCardStorage)
    }
  }, [])

  // Tells \`cart-get-total\` that a stored card is to be honoured and in which
  // currency. Merged rather than written whole: the quantity cap, delivery
  // snapshot and the other feature mirrors share the key.
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
            giftCards: {
              enabled: true,
              currency: GIFT_CARDS.currency,
              recurringTender: GIFT_CARDS.recurringTender,
            },
          })
        )
      )
    } catch (e) {}
  }, [])
`

/**
 * The `giftCardMeta` memo the `Cart` keys read, in its two shapes: priced
 * from the stored card when the feature is on, or the "no card" constants
 * with an amount due equal to each total when it is off. Emitted after
 * `effectiveTotal` and `pickupTotal` exist.
 */
export const generateGiftCardMetaCode = (giftCardsEnabled: boolean): string => {
  if (giftCardsEnabled) {
    return `  const giftCardMeta = useMemo(
    () =>
      computeGiftCardMeta(
        appliedGiftCard,
        effectiveTotal,
        pickupTotal,
        cartHasGiftCardLines(cartItems),
        !!recurringLine,
        recurringTrial
      ),
    [appliedGiftCard, effectiveTotal, pickupTotal, cartItems, recurringLine, recurringTrial]
  )
`
  }
  return `  const giftCardMeta = useMemo(
    () => ({
      giftCardApplied: 'false',
      giftCardLast4: '',
      giftCardAmount: '0.00',
      giftCardAmountPickup: '0.00',
      amountDue: formatCartMoney(effectiveTotal),
      amountDuePickup: formatCartMoney(pickupTotal),
    }),
    [effectiveTotal, pickupTotal]
  )
`
}
