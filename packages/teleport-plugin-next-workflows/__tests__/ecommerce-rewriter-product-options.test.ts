import { ProductOptions } from '@teleporthq/teleport-shared'
import { rewriteLowStockCustomHandlers } from '../src/ecommerce-customhandler-rewriter'
import { __testables as cartAvailability } from '../src/ecommerce/cart-availability'

/**
 * The export-time rewriters recognise the editor's baked scripts by the tokens
 * they contain and swap in their own code. Product options put a large helper
 * block (and new fields) into the add-to-cart, checkout and order scripts, so
 * the block must never carry a rewriter's trigger tokens — a script it lands
 * in would be silently replaced — while the add-to-cart limit check, which
 * learned the configuration key, must still be the one script replaced.
 */

const HELPERS = ProductOptions.generateProductOptionsHelperCode()

// The editor's "Evaluate Cart Item Limit" script with the line identity
// extended by the configuration key (`params[7]` is the priced product).
const EVALUATE_WITH_CONFIGURATION = `function customHandler(previousContext, params) {
  var settingsCtx = params[2];
  var extractCtx = params[0];
  var checkResult = params[7];
  var cartItems = params[13];
  var productId = extractCtx ? extractCtx.productId : "";
  var variantId = extractCtx ? (extractCtx.variantId || null) : null;
  var configurationKey = checkResult && checkResult.productConfigurationKey ? checkResult.productConfigurationKey : "";
  var items = cartItems && Array.isArray(cartItems) ? cartItems : [];
  var existingItem = null;
  var existingQuantity = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].productId === productId && (items[i].variantId || null) === (variantId || null) && (items[i].configurationKey || "") === configurationKey) {
      existingItem = items[i];
      existingQuantity = Number(items[i].quantity) || 0;
      break;
    }
  }
  var maxQty = settingsCtx ? settingsCtx.maxQuantityPerProduct : null;
  if (maxQty !== null && maxQty !== undefined && Number(maxQty) > 0 && existingQuantity >= Number(maxQty)) {
    return { canAdd: false, message: "Limit", existingItemId: existingItem ? existingItem.id : null, shouldIncrement: false };
  }
  return { canAdd: true, message: "", existingItemId: existingItem ? existingItem.id : null, shouldIncrement: existingItem !== null };
}`

// The shapes the helper block is baked into: a custom node's first script (the
// block inside the handler body), and a workflow script (the block ahead of
// the handler), each reading the priced product the way the editor does.
const PRICE_CHECK_WITH_HELPERS = `async function customHandler(previousContext, params) {
${HELPERS}
  var result = params[6];
  var rows = result && result.rows ? result.rows : [];
  var found = rows.length > 0;
  var product = found ? rows[0] : null;
  var resolved = __poResolveForRow(product, product ? Number(product.price) : 0, params.optionsConfig);
  return { found: found, product: product, productPrice: resolved.delta, productConfigurationKey: resolved.key, optionsOk: resolved.valid ? 'true' : 'false' };
}`

const ASSEMBLE_WITH_HELPERS = `${HELPERS}
function customHandler(params) {
  var lines = [];
  var cartItems = params[2] && params[2].items ? params[2].items : [];
  for (var i = 0; i < cartItems.length; i++) {
    var res = __poResolveForRow(null, Number(cartItems[i].basePrice) || 0, cartItems[i].configuration);
    lines.push({ id: cartItems[i].id, label: res.label, snapshot: JSON.stringify({ v: 1, entries: res.entries }) });
  }
  return { product_option_lines: lines };
}`

const buildUidl = (codes: string[]) =>
  ({
    workflows: {
      workflows: {
        checkout: {
          id: 'checkout',
          nodes: codes.map((code, index) => ({
            id: 'wf-' + index,
            type: 'general-custom-js',
            config: { code },
          })),
        },
      },
      customNodes: {
        atc: {
          id: 'atc',
          name: 'Add Product To Cart Logic',
          nodes: codes.map((code, index) => ({
            id: 'cn-' + index,
            type: 'general-custom-js',
            config: { code },
          })),
        },
      },
    },
    ecommerceSettings: {
      stockManagement: true,
      stockManagementConfig: {
        allowBackorders: false,
        lowStockThreshold: 5,
        lowStockAlerts: false,
        maxQuantityPerProduct: 5,
      },
    },
  } as any)

const TOTAL_REWRITES = (summary: ReturnType<typeof rewriteLowStockCustomHandlers>): number =>
  summary.selectBuilderRewrites +
  summary.emailPayloadRewrites +
  summary.paymentMetadataBuilderRewrites +
  summary.stockDecrementBuilderRewrites +
  summary.placeOrderAvailabilityRewrites +
  summary.addToCartStockCheckRewrites +
  summary.addToCartLimitCheckRewrites +
  summary.orderNumberGeneratorRewrites +
  summary.orderOwnershipRewrites +
  summary.variantPickerGateRewrites

describe('export-time rewriters and the product options helper block', () => {
  it('carries none of the add-to-cart limit check trigger tokens', () => {
    for (const token of ['canAdd', 'shouldIncrement', 'existingItemId', 'maxQuantityPerProduct']) {
      expect(HELPERS).not.toContain(token)
    }
  })

  it('leaves every script the block is baked into untouched', () => {
    const codes = [PRICE_CHECK_WITH_HELPERS, ASSEMBLE_WITH_HELPERS]
    const uidl = buildUidl(codes)
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(TOTAL_REWRITES(summary)).toBe(0)
    expect(uidl.workflows.workflows.checkout.nodes.map((node: any) => node.config.code)).toEqual(
      codes
    )
    expect(uidl.workflows.customNodes.atc.nodes.map((node: any) => node.config.code)).toEqual(codes)
  })

  it('still replaces the limit check once it compares the configuration key', () => {
    expect(cartAvailability.looksLikeAddToCartLimitCheck(EVALUATE_WITH_CONFIGURATION)).toBe(true)
    const uidl = buildUidl([EVALUATE_WITH_CONFIGURATION, PRICE_CHECK_WITH_HELPERS])
    const summary = rewriteLowStockCustomHandlers(uidl)
    expect(summary.addToCartLimitCheckRewrites).toBe(2)
    expect(TOTAL_REWRITES(summary)).toBe(2)
    const [limitCheck, priceCheck] = uidl.workflows.customNodes.atc.nodes
    expect(limitCheck.config.code).toBe(cartAvailability.buildAddToCartLimitCheck())
    expect(priceCheck.config.code).toBe(PRICE_CHECK_WITH_HELPERS)
  })
})
