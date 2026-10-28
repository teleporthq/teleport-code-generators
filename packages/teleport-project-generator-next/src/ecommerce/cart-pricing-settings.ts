import { UIDLEcommerceSettings, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { StorefrontTax } from '@teleporthq/teleport-shared'
import { resolveDiscountEngine } from './ecommerce-discount-engine-code'
import { resolveGiftCards } from './ecommerce-gift-card-code'
import {
  RegionalPricingStoreDefaults,
  resolveRegionalPricing,
} from './ecommerce-regional-pricing-code'
import { toClientPaymentProvider } from './payment-provider-kinds'

/**
 * Everything the store's own settings contribute to pricing a cart — the
 * delivery fee and threshold, the storefront tax, which features price the
 * order (regional zones, the discount rule feed, gift cards, vouchers), and
 * which providers may bill which cart. Baked at export.
 *
 * ONE SNAPSHOT, TWO READERS. The storefront provider mirrors these values into
 * `workflow_cart_settings` for the buyer's own summary, and the checkout's
 * server step (`cart-price-order`) prices the order from the same values,
 * loaded from `utils/ecommerce/cart-pricing-settings.js` — a server-only
 * module no browser request can hand a different copy of.
 */
export interface CartPricingSettings {
  dataSourceId: string | null
  deliveryConfig: {
    deliveryEnabled: boolean
    storePickupEnabled: boolean
    deliveryPrice: number
    freeDeliveryEnabled: boolean
    freeDeliveryThreshold: number
  }
  taxConfig: { storefrontTaxRate: number }
  vouchersEnabled: boolean
  subscriptions: { enabled: boolean; providers: string[] }
  paymentKinds: Record<string, unknown>
  /**
   * How a buyer may pay: cash on delivery when the store takes it, otherwise
   * one of the store's enabled online providers. The checkout's server step
   * refuses every other method, an empty one included: an order is never
   * read as cash on delivery because no method was named.
   *
   * `codByShippingZone`: delivery is priced by shipping zone, and each zone
   * decides whether it takes cash on delivery (`teleport_shipping_zones.
   * cod_enabled`, rows the merchant edits live). The settle write refuses a
   * cash order delivered to a zone that does not take it (the workflows
   * plugin's `place-order-guards.ts`, re-baked from the same setting).
   */
  paymentMethods: { cashOnDelivery: boolean; providers: string[]; codByShippingZone: boolean }
  /**
   * Stock is managed and backorders are off, so the checkout reserves stock
   * with the order: the server step then also releases the reservations of
   * orders that never reached a payment page (the workflows plugin's
   * `place-order-guards.ts`, `buildStalledReservationReleaseQuery`).
   */
  releaseStalledReservations: boolean
  regional: {
    store: RegionalPricingStoreDefaults
    currency: string
    countryCodes: unknown
    storeCountryCode: string
  } | null
  discounts: { automaticDiscounts: boolean } | null
  giftCards: { currency: string; recurringTender: boolean } | null
}

export const buildCartPricingSettings = (
  ecommerceSettings: UIDLEcommerceSettings,
  invoiceSettings: UIDLInvoiceSettings | undefined,
  dataSourceId: string | null,
  dataSourceType: string | null
): CartPricingSettings => {
  const clientPaymentProviders = (ecommerceSettings.paymentProviders || []).map(
    toClientPaymentProvider
  )
  const deliveryConfig = {
    deliveryEnabled: ecommerceSettings.deliveryEnabled === true,
    storePickupEnabled: ecommerceSettings.storePickupEnabled === true,
    deliveryPrice: Number(ecommerceSettings.deliveryConfig?.deliveryPrice ?? 0) || 0,
    freeDeliveryEnabled: !!ecommerceSettings.deliveryConfig?.freeDeliveryEnabled,
    freeDeliveryThreshold:
      Number(ecommerceSettings.deliveryConfig?.freeDeliveryThreshold ?? 0) || 0,
  }
  const regional = resolveRegionalPricing(ecommerceSettings, dataSourceId)
  const discountEngine = resolveDiscountEngine(ecommerceSettings, dataSourceId)
  const giftCards = resolveGiftCards(ecommerceSettings, dataSourceId, dataSourceType)
  return {
    dataSourceId,
    deliveryConfig,
    taxConfig: { storefrontTaxRate: StorefrontTax.resolveStorefrontTaxRate(invoiceSettings) },
    vouchersEnabled: ecommerceSettings.vouchersEnabled === true,
    subscriptions: {
      enabled: ecommerceSettings.subscriptions?.enabled === true,
      providers: clientPaymentProviders
        .filter((provider) => provider.supportsSubscriptions)
        .map((provider) => provider.type),
    },
    paymentKinds: Object.fromEntries(
      clientPaymentProviders.map((provider) => [provider.type, provider.kinds])
    ),
    paymentMethods: {
      cashOnDelivery: ecommerceSettings.cashOnDelivery === true,
      providers: clientPaymentProviders.map((provider) => provider.type),
      codByShippingZone: regional !== null,
    },
    releaseStalledReservations:
      ecommerceSettings.stockManagement === true &&
      ecommerceSettings.stockManagementConfig?.allowBackorders !== true,
    regional: regional
      ? {
          store: {
            ...deliveryConfig,
            defaultTaxRate: Number(invoiceSettings?.defaultTaxRate) || 0,
            defaultTaxIncluded: invoiceSettings?.taxIncludedInPrice === true,
          },
          currency: regional.currency,
          countryCodes: regional.countryCodes,
          storeCountryCode: regional.storeCountryCode,
        }
      : null,
    discounts: discountEngine
      ? { automaticDiscounts: discountEngine.automaticDiscounts === true }
      : null,
    giftCards: giftCards
      ? { currency: giftCards.currency, recurringTender: giftCards.recurringTender === true }
      : null,
  }
}

/** `utils/ecommerce/cart-pricing-settings.js` — required only by server routes. */
export const generateCartPricingSettingsModule = (settings: CartPricingSettings): string =>
  `'use strict';
/**
 * The store's pricing settings as they were at export — what the checkout's
 * server step prices an order from (see cart-price-order). Generated by
 * TeleportHQ; changes are overwritten on the next export.
 */
module.exports = ${JSON.stringify(settings, null, 2)};
`
