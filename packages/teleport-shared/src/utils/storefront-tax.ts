import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

/**
 * Storefront-facing view of the invoice panel's Tax card
 * (`Default Tax Rate (%)` + `Added on top` / `Included in price`).
 *
 * `teleport_products.price` stores a single number whose MEANING depends on the
 * inclusion mode:
 *
 *   - `Included in price` → it is already the gross, customer-paid price;
 *     nothing is added anywhere and the invoice splits the VAT back out of it.
 *   - `Added on top`      → it is the NET price and the customer actually pays
 *     `price × (1 + rate/100)`, so every surface that DISPLAYS or CHARGES a
 *     price has to add the tax itself.
 *
 * Exactly one mode moves a displayed price, so this collapses the pair down to
 * a single number: the percentage to ADD, or `0` for "leave the stored price
 * alone".
 *
 * The gate is `defaultTaxRate > 0`, deliberately NOT `invoiceSettings.enabled`:
 * `enabled` is auto-cleared when the last payment provider is removed, and
 * binding prices to it would mean deleting a Stripe key silently re-prices the
 * whole catalogue. A missing `taxIncludedInPrice` is "added on top" — documents
 * created before the field existed coerce that way everywhere else too.
 *
 * Mirrors the editor's copy in teleport-gui
 * `app/project-page/features/e-commerce/utils/storefront-tax.ts`. Keep the two
 * in lockstep.
 */
export const resolveStorefrontTaxRate = (invoiceSettings?: UIDLInvoiceSettings | null): number => {
  if (!invoiceSettings || invoiceSettings.taxIncludedInPrice === true) {
    return 0
  }
  const rate = Number(invoiceSettings.defaultTaxRate)
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

/**
 * Gross counterpart of a stored (net) amount. Returns the amount untouched when
 * no tax has to be added, so a project with no configured rate is bit-for-bit
 * what it was before storefront tax existed — in particular it does NOT start
 * rounding stored prices.
 *
 * When tax IS added the result is snapped to cents at the point it is derived:
 * `19.99 * 1.19` is `23.788099999999996`, and a bound value is printed verbatim
 * with no `toFixed` between the row and the DOM.
 */
export const applyStorefrontTax = (amount: number, taxRate: number): number => {
  const base = Number(amount)
  const safeBase = Number.isFinite(base) ? base : 0
  if (!(taxRate > 0)) {
    return safeBase
  }
  return Math.round(safeBase * (1 + taxRate / 100) * 100) / 100
}

/**
 * Marker line every generated storefront-tax helper starts with. The GUI's
 * export pass rewrites this exact literal so a rate change reaches scripts that
 * were baked into the project document long before it — see
 * `refresh-storefront-tax-rate.ts` in teleport-gui. Any emitter that changes the
 * spelling has to update that pass too.
 */
export const STOREFRONT_TAX_RATE_DECLARATION = 'var STOREFRONT_TAX_RATE = '

/**
 * ES5 source for the tax helper, for embedding into generated runtime code
 * (data-source transforms, API routes) that cannot import from this package.
 *
 * Emits `STOREFRONT_TAX_RATE`, `applyStorefrontTax(amount)` returning a NUMBER,
 * `grossMoney(amount)` returning a 2-decimal STRING — the shape a template token
 * or a bound text node needs — and `grossLineMoney(amount, quantity)` for line
 * totals.
 */
export const generateStorefrontTaxHelperCode = (taxRate: number): string => {
  const safeRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0
  return `// Percentage added on top of every stored (NET) price. Baked from the
// merchant's invoice settings; \`0\` means the stored price is already what the
// customer pays. The stored cart and the persisted order lines stay NET — the
// tax is added only where a price is displayed or charged, so it can never be
// applied twice.
${STOREFRONT_TAX_RATE_DECLARATION}${safeRate};

function applyStorefrontTax(amount) {
  var base = Number(amount);
  if (!isFinite(base)) base = 0;
  if (!(STOREFRONT_TAX_RATE > 0)) return base;
  // Rounded per UNIT (not per line) so \`unit price x quantity\` equals the line
  // total printed beside it.
  return Math.round(base * (1 + STOREFRONT_TAX_RATE / 100) * 100) / 100;
}

function grossMoney(amount) {
  if (amount == null || amount === '') return '0.00';
  var n = Number(amount);
  // A cell we cannot parse is shown as-is rather than replaced by an invented
  // price — the same rule the untaxed money formatters have always applied.
  if (!isFinite(n)) return String(amount);
  return applyStorefrontTax(n).toFixed(2);
}

// The same 2-decimal formatting WITHOUT the tax, for a value that is stored
// rather than displayed. Kept beside \`grossMoney\` so the pair reads as the one
// decision it is: does this number get shown, or written down?
function netMoney(amount) {
  if (amount == null || amount === '') return '0.00';
  var n = Number(amount);
  if (!isFinite(n)) return String(amount);
  return n.toFixed(2);
}

// A line total is the GROSS UNIT price times the quantity, never the net line
// total taxed as a lump: rounding happens once, per unit, so the unit price a
// shopper reads really does multiply into the line total printed beside it.
//
// With no tax to add there is nothing to re-derive, so the stored line total is
// returned verbatim — an untaxed store keeps rendering exactly what it always
// did, including a hand-edited line that does not equal unit x quantity.
function grossLineMoney(unitAmount, quantity, storedTotal) {
  var unit = Number(unitAmount);
  if ((!(STOREFRONT_TAX_RATE > 0) || !isFinite(unit)) && storedTotal != null && storedTotal !== '') {
    return grossMoney(storedTotal);
  }
  var qty = Number(quantity);
  if (!isFinite(qty) || qty <= 0) qty = 1;
  return (Math.round(applyStorefrontTax(unitAmount) * qty * 100) / 100).toFixed(2);
}`
}

/**
 * ES5 helpers for a generated route that shows the lines of a PLACED order —
 * the merchant's order-notification email. Mirrors teleport-gui's
 * `ORDER_LINE_TAX_SCRIPT` (`storefront-tax-script.ts`), which the storefront's
 * baked workflows run; `__tests__/utils/order-line-tax.ts` and the GUI's
 * `order-line-pricing-parity.spec.ts` run the same fixture table over both.
 *
 * What a line cost the buyer is decided once, at checkout, and written to
 * `teleport_order_items` (`unit_price_paid`, `total_price_paid`, `tax_rate`,
 * `tax_included`). A reader prefers the record (`orderLineTaxOf`,
 * `paidAmountAt`) and DERIVES it only for a line written before the record
 * existed: from the rate its order's `tax_breakdown` recorded for it (an order
 * priced by region), else from `STOREFRONT_TAX_RATE`.
 *
 * Requires the prelude from `generateStorefrontTaxHelperCode` in scope.
 */
export const generateOrderLineTaxHelperCode = (): string => `
// Every line of an order carries the same breakdown text: parse it once.
var orderLineTaxRaw = null;
var orderLineTaxParsed = null;
function parseOrderLineTaxBreakdown(breakdown) {
  var parsed = breakdown;
  if (typeof breakdown === 'string') {
    if (breakdown !== orderLineTaxRaw) {
      orderLineTaxRaw = breakdown;
      try { orderLineTaxParsed = breakdown ? JSON.parse(breakdown) : null; } catch (e) { orderLineTaxParsed = null; }
    }
    parsed = orderLineTaxParsed;
  }
  return parsed && typeof parsed === 'object' && Array.isArray(parsed.lines) ? parsed : null;
}
function orderLineTaxDecimals(parsed) {
  return parsed && parsed.taxDecimals === 0 ? 0 : 2;
}
function orderLineTaxIncluded(value) {
  return value === true || value === 'true' || value === 't' || value === 1 || value === '1';
}
// The tax one line was charged at: { rate, included, decimals }.
function orderLineTax(breakdown, productId, variantId) {
  var parsed = parseOrderLineTaxBreakdown(breakdown);
  if (!parsed) {
    return { rate: STOREFRONT_TAX_RATE > 0 ? STOREFRONT_TAX_RATE : 0, included: false, decimals: 2 };
  }
  var pid = String(productId == null ? '' : productId);
  var vid = String(variantId == null ? '' : variantId);
  var match = null;
  for (var li = 0; li < parsed.lines.length; li++) {
    var line = parsed.lines[li];
    if (line && String(line.productId || '') === pid && String(line.variantId || '') === vid) {
      match = line;
      break;
    }
  }
  var source = match || parsed;
  var rate = Number(source.taxRate);
  if (!isFinite(rate) || rate < 0) rate = 0;
  return { rate: rate, included: source.taxIncluded === true, decimals: orderLineTaxDecimals(parsed) };
}
// The tax a stored line was RECORDED with, else \`orderLineTax\`.
function orderLineTaxOf(breakdown, productId, variantId, storedRate, storedIncluded) {
  var rate = storedRate == null || storedRate === '' ? NaN : Number(storedRate);
  if (!isFinite(rate) || rate < 0) return orderLineTax(breakdown, productId, variantId);
  return {
    rate: rate,
    included: orderLineTaxIncluded(storedIncluded),
    decimals: orderLineTaxDecimals(parseOrderLineTaxBreakdown(breakdown))
  };
}
function grossAmountAt(amount, tax) {
  var base = Number(amount);
  if (!isFinite(base)) base = 0;
  if (!tax || tax.included === true || !(tax.rate > 0)) return base;
  var factor = tax.decimals === 0 ? 1 : 100;
  return Math.round(base * (1 + tax.rate / 100) * factor) / factor;
}
// What the buyer paid, as RECORDED on the line; derived for an older line.
function paidAmountAt(paidAmount, netAmount, tax) {
  var paid = paidAmount == null || paidAmount === '' ? NaN : Number(paidAmount);
  return isFinite(paid) ? paid : grossAmountAt(netAmount, tax);
}`
