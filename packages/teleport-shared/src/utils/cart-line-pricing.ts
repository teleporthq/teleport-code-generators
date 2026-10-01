/**
 * What one cart line costs, read off its product (and variant) row, as ES5
 * source for generated runtime code that cannot import from this package.
 *
 * TWO READERS, ONE RULE. The storefront provider re-prices every line with it
 * when it hydrates the cart (`enrichCartItems` in the e-commerce context), and
 * the checkout's server step prices the order with it (`cart-price-order` in
 * the workflows plugin) — so what the buyer is shown and what the order is
 * charged come from the same arithmetic over the same row. A price the
 * browser holds is never an input: the line keeps only what the buyer chose
 * (product, variant, options, quantity).
 *
 * The rule: the variant's price overrides the product's; the per-product
 * markdown live at `nowMs` comes off that NET price; the chosen options'
 * surcharge is added on top of the charged base (options are never marked
 * down). A subscription is one unit.
 *
 * Needs, in the same scope: the per-product discount helpers (`__pd*`,
 * `ProductDiscounts.generateProductDiscountHelperCode`), the product-option
 * helpers (`__po*`, `ProductOptions.generateProductOptionsHelperCode`) and the
 * discount engine's row readers (`__deStringArray`, `__deBool`,
 * `DiscountEngine.generateDiscountEngineHelperCode`).
 */
export const generateCartLinePricingHelperCode = (): string => `
// ── Cart line pricing ────────────────────────────────────────────────────────
var __CL_BILLING_INTERVALS = ['day', 'week', 'month', 'year'];

function __clIsRecurring(product) {
  return String((product && product.payment_type) || '').trim().toLowerCase() === 'recurring';
}

function __clBillingInterval(value) {
  var normalized = String(value == null ? '' : value).trim().toLowerCase();
  return __CL_BILLING_INTERVALS.indexOf(normalized) !== -1 ? normalized : 'month';
}

function __clBillingIntervalCount(value) {
  var parsed = Math.floor(Number(value));
  return isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function __clPositiveCount(value) {
  if (value === null || value === undefined || value === '') { return null; }
  var parsed = Math.floor(Number(value));
  return isFinite(parsed) && parsed > 0 ? parsed : null;
}

// The chosen options re-priced from the product's CURRENT definitions on the
// charged base, and whether the answers still fit (\`configurationStale\`, which
// the checkout refuses). Null for a line with no answers of a product with no
// options, which is priced exactly as before; cleared fields for a line that
// carried options its product no longer has.
function __clPriceLineOptions(item, product, basePrice) {
  var entries = __poParseEntries(item.configuration);
  if (entries.length === 0 && __poParseGroups(product.option_groups).length === 0) {
    if (item.basePrice == null && item.configurationLabel == null && item.configurationPriceDelta == null && item.configurationStale == null) { return null; }
    return { basePrice: null, configurationLabel: null, configurationPriceDelta: null, configurationStale: null };
  }
  var resolved = __poResolveForRow(product, basePrice, entries);
  return {
    basePrice: basePrice,
    configurationLabel: resolved.label,
    configurationPriceDelta: resolved.delta,
    configurationStale: !resolved.valid
  };
}

// "Red / XL" — the variant's value labels along the product's (language-
// resolved) option axes.
function __clVariantLabel(variantOptionsRaw, optionsMap) {
  var axes = variantOptionsRaw;
  if (typeof axes === 'string') { try { axes = JSON.parse(axes); } catch (e) { axes = []; } }
  if (!Array.isArray(axes)) { return ''; }
  var opts = optionsMap;
  if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (e) { opts = {}; } }
  if (!opts) { opts = {}; }
  var parts = [];
  for (var a = 0; a < axes.length; a++) {
    var axis = axes[a];
    if (!axis || !axis.key) { continue; }
    var valueKey = opts[axis.key];
    if (valueKey == null) { continue; }
    var label = valueKey;
    var values = Array.isArray(axis.values) ? axis.values : [];
    for (var v = 0; v < values.length; v++) { if (values[v] && values[v].value === valueKey) { label = values[v].label || valueKey; break; } }
    parts.push(label);
  }
  return parts.join(' / ');
}

// The colour(s) of the variant's value on every COLOUR axis, for the swatch
// shown beside the label.
function __clVariantSwatches(variantOptionsRaw, optionsMap) {
  var axes = variantOptionsRaw;
  if (typeof axes === 'string') { try { axes = JSON.parse(axes); } catch (e) { axes = []; } }
  if (!Array.isArray(axes)) { return []; }
  var opts = optionsMap;
  if (typeof opts === 'string') { try { opts = JSON.parse(opts); } catch (e) { opts = {}; } }
  if (!opts) { opts = {}; }
  var swatches = [];
  for (var a = 0; a < axes.length; a++) {
    var axis = axes[a];
    if (!axis || !axis.key || axis.type !== 'color') { continue; }
    var valueKey = opts[axis.key];
    if (valueKey == null) { continue; }
    var values = Array.isArray(axis.values) ? axis.values : [];
    for (var v = 0; v < values.length; v++) { if (values[v] && values[v].value === valueKey && values[v].color) { swatches.push({ color: values[v].color }); break; } }
  }
  return swatches;
}

// The line's price and everything the totals read off its product, for the
// row as it is at \`nowMs\`. \`withWeight\` adds the weight the regional
// shipping rates price by.
function __clPriceLine(item, product, variant, nowMs, withWeight) {
  var price = product.price != null ? Number(product.price) : 0;
  if (variant && variant.price != null) { price = Number(variant.price); }
  var discount = __pdResolveActive(product.discounts, nowMs);
  var listPrice = price;
  price = __pdDiscountedPrice(listPrice, discount);
  var options = __clPriceLineOptions(item, product, price);
  var optionsDelta = options ? options.configurationPriceDelta : null;
  var recurring = __clIsRecurring(product);
  var priced = {
    price: optionsDelta != null ? __poRound2(price + optionsDelta) : price,
    originalPrice: discount ? (optionsDelta != null ? __poRound2(listPrice + optionsDelta) : listPrice) : null,
    discountType: discount ? discount.type : null,
    discountValue: discount ? discount.value : null,
    discountAmount: discount ? __pdDiscountAmount(listPrice, discount) : 0,
    categoryIds: __deStringArray(product.category_filter_ids || product.category_ids),
    isGiftCard: __deBool(product.is_gift_card, false),
    isRecurring: recurring,
    recurringInterval: recurring ? __clBillingInterval(product.recurring_interval) : null,
    recurringIntervalCount: recurring ? __clBillingIntervalCount(product.recurring_interval_count) : null,
    trialDays: recurring ? __clPositiveCount(product.trial_days) : null,
    isDigital: __deBool(product.is_digital, false),
    quantity: recurring ? 1 : item.quantity
  };
  if (withWeight) {
    priced.weight = product.weight != null ? Number(product.weight) : null;
    priced.weightUnit = product.weight_unit || null;
  }
  if (options) {
    priced.basePrice = options.basePrice;
    priced.configurationLabel = options.configurationLabel;
    priced.configurationPriceDelta = options.configurationPriceDelta;
    priced.configurationStale = options.configurationStale;
  }
  return priced;
}
`
