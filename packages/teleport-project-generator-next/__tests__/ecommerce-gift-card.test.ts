/* tslint:disable:no-eval function-constructor */
import { parse } from '@babel/parser'
import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'
import { DiscountEngine } from '@teleporthq/teleport-shared'
import { generateEcommerceContextFileContent } from '../src/ecommerce/ecommerce-context-generator'
import { buildWorkflowEcommerceSettingsPayload } from '../src/ecommerce/ecommerce-api-routes-generator'
import { resolveGiftCards } from '../src/ecommerce/ecommerce-gift-card-code'

/**
 * The storefront provider's half of gift cards as a checkout TENDER.
 *
 * The tender rule is pinned by teleport-shared's parity table. What this pins
 * is the provider around it: a store without the feature reads no stored card
 * yet still exposes the six tender keys (an amount due equal to the total), a
 * store with it displays what the Apply Gift Card workflow left in storage
 * and NEVER reads a card from the database, and the projection to what the
 * summary rows bind is right — run, not pattern-matched.
 */

const baseSettings = (overrides: Partial<UIDLEcommerceSettings> = {}): UIDLEcommerceSettings =>
  ({
    cashOnDelivery: true,
    deliveryEnabled: true,
    storePickupEnabled: true,
    guestCheckout: true,
    stockManagement: false,
    orderNotifications: false,
    deliveryConfig: {
      deliveryPrice: 10,
      freeDeliveryEnabled: false,
      freeDeliveryThreshold: 0,
      allowDeliveryNotes: true,
    },
    stockManagementConfig: null,
    orderNotificationConfig: null,
    paymentProviders: [],
    vouchersEnabled: true,
    ...overrides,
  } as UIDLEcommerceSettings)

const GIFT_CARDS = { enabled: true, currency: 'EUR' }

const giftCardSource = (overrides: Partial<UIDLEcommerceSettings> = {}): string =>
  generateEcommerceContextFileContent(
    baseSettings({ giftCards: GIFT_CARDS, ...overrides }),
    undefined,
    'ds-1',
    true,
    true,
    false,
    'teleport'
  )

const grab = (source: string, name: string): string => {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) {
    throw new Error(`emitted provider is missing function ${name}`)
  }
  const end = source.indexOf('\n}', start)
  return source.slice(start, end + 2)
}

const constant = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name} = `)
  if (start === -1) {
    throw new Error(`emitted provider is missing const ${name}`)
  }
  return source.slice(start, source.indexOf('\n', start))
}

const GIFT_CARD_KEYS = [
  'giftCardApplied',
  'giftCardLast4',
  'giftCardAmount',
  'giftCardAmountPickup',
  'amountDue',
  'amountDuePickup',
]

describe('resolveGiftCards', () => {
  it('needs the block, the flag, a datasource and a Postgres datasource type', () => {
    const settings = baseSettings({ giftCards: GIFT_CARDS })
    expect(resolveGiftCards(settings, 'ds-1', 'teleport')).toEqual(GIFT_CARDS)
    expect(resolveGiftCards(settings, 'ds-1', 'postgresql')).toEqual(GIFT_CARDS)
    expect(resolveGiftCards(settings, 'ds-1', 'mysql')).toBeNull()
    expect(resolveGiftCards(settings, 'ds-1', null)).toBeNull()
    expect(resolveGiftCards(settings, null, 'teleport')).toBeNull()
    expect(resolveGiftCards(baseSettings(), 'ds-1', 'teleport')).toBeNull()
    expect(
      resolveGiftCards(
        baseSettings({ giftCards: { ...GIFT_CARDS, enabled: false } }),
        'ds-1',
        'teleport'
      )
    ).toBeNull()
    expect(resolveGiftCards({} as UIDLEcommerceSettings, null, null)).toBeNull()
  })
})

describe('EcommerceProvider — gift cards are opt-in', () => {
  it('reads no stored card for a store without the feature, yet binds every key', () => {
    const legacy = generateEcommerceContextFileContent(
      baseSettings(),
      undefined,
      'ds-1',
      true,
      true,
      false,
      'teleport'
    )
    expect(legacy).not.toContain(DiscountEngine.GIFT_CARD_STORAGE_KEY)
    expect(legacy).not.toContain(DiscountEngine.GIFT_CARD_CHANGED_EVENT)
    expect(legacy).not.toContain('loadGiftCardFromStorage')
    expect(legacy).not.toContain('appliedGiftCard')
    for (const key of GIFT_CARD_KEYS) {
      expect(legacy).toContain(`${key}: giftCardMeta.${key},`)
    }
    expect(legacy).toContain("giftCardApplied: 'false',")
    expect(legacy).toContain('amountDue: formatCartMoney(effectiveTotal),')
    expect(legacy).toContain('amountDuePickup: formatCartMoney(pickupTotal),')
    expect(legacy).toContain('"giftCardsEnabled":false')
  })

  it('stays off for a datasource that cannot run the ledger SQL', () => {
    const mysql = generateEcommerceContextFileContent(
      baseSettings({ giftCards: GIFT_CARDS }),
      undefined,
      'ds-1',
      false,
      true,
      false,
      'mysql'
    )
    expect(mysql).not.toContain('loadGiftCardFromStorage')
    const untyped = generateEcommerceContextFileContent(
      baseSettings({ giftCards: GIFT_CARDS }),
      undefined,
      'ds-1'
    )
    expect(untyped).not.toContain('loadGiftCardFromStorage')
  })
})

describe('EcommerceProvider — gift card emitted module', () => {
  const source = giftCardSource()

  it('parses as the JSX module Next compiles', () => {
    expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
  })

  it('never reads a gift card over the network — only what the workflow stored', () => {
    // The only datasource reads in the whole module are the ones every store
    // makes (products for hydration); the gift-card tables are server-only.
    expect(source).not.toContain('teleport_gift_cards')
    expect(source).not.toContain('teleport_gift_card_transactions')
    expect(source).toContain(
      `const GIFT_CARD_STORAGE_KEY = '${DiscountEngine.GIFT_CARD_STORAGE_KEY}'`
    )
    expect(source).toContain(
      `const GIFT_CARD_CHANGED_EVENT = '${DiscountEngine.GIFT_CARD_CHANGED_EVENT}'`
    )
    expect(source).toContain('window.addEventListener(GIFT_CARD_CHANGED_EVENT, syncGiftCard)')
    expect(source).toContain('if (e.key === GIFT_CARD_STORAGE_KEY) syncGiftCard()')
  })

  it('tells cart-get-total the feature is on, by merge, and the flag is on Settings', () => {
    expect(source).toContain(
      'Object.assign({}, current, {\n            giftCards: {\n              enabled: true,\n              currency: GIFT_CARDS.currency,\n              recurringTender: GIFT_CARDS.recurringTender,\n            },'
    )
    expect(source).toContain('"giftCardsEnabled":true')
    expect(
      buildWorkflowEcommerceSettingsPayload(baseSettings({ giftCards: GIFT_CARDS }))
        .giftCardsEnabled
    ).toBe(true)
    expect(buildWorkflowEcommerceSettingsPayload(baseSettings()).giftCardsEnabled).toBe(false)
  })

  it('prices both fulfilment shapes and re-renders when the card or totals move', () => {
    expect(source).toContain(
      'computeGiftCardMeta(\n        appliedGiftCard,\n        effectiveTotal,\n        pickupTotal,\n        cartHasGiftCardLines(cartItems),\n        !!recurringLine,\n        recurringTrial\n      )'
    )
    expect(source).toContain(
      '[appliedGiftCard, effectiveTotal, pickupTotal, cartItems, recurringLine, recurringTrial]'
    )
    const depsAt = source.lastIndexOf('}), [displayCartItems')
    const deps = source.slice(depsAt, source.indexOf('])', depsAt))
    expect(deps).toContain('giftCardMeta')
    expect(deps).toContain('effectiveTotal')
    expect(deps).toContain('pickupTotal')
  })
})

interface GiftCardMeta {
  giftCardApplied: string
  giftCardLast4: string
  giftCardAmount: string
  giftCardAmountPickup: string
  amountDue: string
  amountDuePickup: string
}

interface StoredCard {
  id: string
  last4: string
  balance: number
  currency: string
  checkedAt: string | null
}

interface GiftCardApi {
  load: () => StoredCard | null
  meta: (
    card: StoredCard | null,
    deliveryTotal: number,
    pickupTotal: number,
    hasGiftCardLines: boolean,
    hasRecurringLines?: boolean
  ) => GiftCardMeta
  hasGiftCardLines: (items: unknown[]) => boolean
}

describe('EcommerceProvider — gift card projections', () => {
  const source = giftCardSource()
  const loadApi = (stored: string | null): GiftCardApi =>
    new Function(
      'localStorage',
      'window',
      [
        DiscountEngine.generateDiscountEngineHelperCode(),
        constant(source, 'GIFT_CARDS'),
        constant(source, 'GIFT_CARD_STORAGE_KEY'),
        grab(source, 'formatCartMoney'),
        grab(source, 'loadGiftCardFromStorage'),
        grab(source, 'cartHasGiftCardLines'),
        grab(source, 'computeGiftCardMeta'),
        'return { load: loadGiftCardFromStorage, meta: computeGiftCardMeta, hasGiftCardLines: cartHasGiftCardLines };',
      ].join('\n')
    )({ getItem: () => stored }, {})

  const CARD: StoredCard = {
    id: 'gc-1',
    last4: 'ABCD',
    balance: 30,
    currency: 'EUR',
    checkedAt: '2026-09-22T10:00:00.000Z',
  }

  it('reads the stored card back, in the store currency only', () => {
    const api = loadApi(JSON.stringify(CARD))
    expect(api.load()).toEqual(CARD)
    expect(loadApi(JSON.stringify({ ...CARD, currency: 'usd' })).load()).toBeNull()
    expect(loadApi(JSON.stringify({ ...CARD, id: '' })).load()).toBeNull()
    expect(loadApi('not json').load()).toBeNull()
    expect(loadApi(null).load()).toBeNull()
    // A balance that cannot be read pays nothing rather than throwing.
    expect(loadApi(JSON.stringify({ ...CARD, balance: 'x' })).load()).toMatchObject({ balance: 0 })
  })

  it('pays the smaller of the balance and each total, as 2-decimal strings', () => {
    const api = loadApi(null)
    expect(api.meta(CARD, 45.5, 35.5, false)).toEqual({
      giftCardApplied: 'true',
      giftCardLast4: 'ABCD',
      giftCardAmount: '30.00',
      giftCardAmountPickup: '30.00',
      amountDue: '15.50',
      amountDuePickup: '5.50',
    })
    expect(api.meta({ ...CARD, balance: 100 }, 45.5, 35.5, false)).toEqual({
      giftCardApplied: 'true',
      giftCardLast4: 'ABCD',
      giftCardAmount: '45.50',
      giftCardAmountPickup: '35.50',
      amountDue: '0.00',
      amountDuePickup: '0.00',
    })
  })

  it('never leaves a remainder the payment provider would refuse', () => {
    const api = loadApi(null)
    // 45.50 − 45.30 = 0.20, below the EUR minimum: the card pays 45.00 instead.
    expect(api.meta({ ...CARD, balance: 45.3 }, 45.5, 45.5, false)).toMatchObject({
      giftCardAmount: '45.00',
      amountDue: '0.50',
    })
  })

  it('reports no card in play when it pays nothing', () => {
    const api = loadApi(null)
    const none = {
      giftCardApplied: 'false',
      giftCardLast4: '',
      giftCardAmount: '0.00',
      giftCardAmountPickup: '0.00',
      amountDue: '45.50',
      amountDuePickup: '35.50',
    }
    expect(api.meta(null, 45.5, 35.5, false)).toEqual(none)
    // A cart that buys a gift card cannot be paid with one.
    expect(api.meta(CARD, 45.5, 35.5, true)).toEqual({ ...none, giftCardLast4: 'ABCD' })
    // A recurring cart is billed by the provider every cycle: the card pays nothing.
    expect(api.meta(CARD, 45.5, 35.5, false, true)).toEqual({ ...none, giftCardLast4: 'ABCD' })
    expect(api.meta({ ...CARD, balance: 0 }, 45.5, 35.5, false)).toEqual({
      ...none,
      giftCardLast4: 'ABCD',
    })
    expect(api.hasGiftCardLines([{ isGiftCard: false }, { isGiftCard: 't' }])).toBe(true)
    expect(api.hasGiftCardLines([{ isGiftCard: false }, {}])).toBe(false)
  })
})
