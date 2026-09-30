/**
 * The binding a route needs when it runs the checkout's server pricing step
 * (`cart-price-order`): the store's pricing settings, baked at export into
 * `utils/ecommerce/cart-pricing-settings.js` by the e-commerce project plugin.
 * A guarded require, so a route evaluated where the module is absent (a store
 * exported without real settings, a test harness) still loads, and the step
 * then refuses to price rather than price from defaults. Empty for every other
 * route, which keeps those byte-identical.
 */
export const CART_PRICING_NODE_TYPE = 'cart-price-order'

export const generateCartPricingPreamble = (
  nodeTypes: Set<string>,
  relativePrefix: string
): string => {
  if (!nodeTypes.has(CART_PRICING_NODE_TYPE)) {
    return ''
  }
  return `var __cartPricingSettings = null;
try { __cartPricingSettings = require('${relativePrefix}/utils/ecommerce/cart-pricing-settings'); } catch (_e) { __cartPricingSettings = null; }
`
}
