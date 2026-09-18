/**
 * Invoice VAT for an order placed on a store with shipping zones and tax
 * jurisdictions, as source for the generated `/api/invoices/generate` route.
 *
 * Such an order does not have ONE rate: a German food line at 7% can sit beside
 * a tools line at 19%, a French order's prices may include VAT while the store
 * default adds it on top, and the delivery fee may be taxed. The store's
 * baked `DEFAULT_TAX_RATE` / `TAX_INCLUDED_IN_PRICE` describe none of that, so
 * the place-order workflow records what was actually charged in
 * `teleport_orders.tax_breakdown`, and this prices the invoice from it.
 *
 * Totals reconcile with `teleport_orders.total_amount` by construction:
 * `goods (gross) + shipping_amount (gross) - discount_amount`. The discount is
 * taken off the goods first and only then off the shipping, exactly as the
 * payment line items split it, and each part's tax shrinks in proportion.
 *
 * The printed rows add up too: `subtotal` (goods, net) + `taxAmount` (goods
 * AND shipping tax) + `shippingNet` = `total`. Delivery is therefore shown net
 * of its tax, or its tax would be counted twice.
 *
 * An order without a breakdown — every order placed before regions existed —
 * returns null and keeps the single-rate arithmetic it was always invoiced with.
 */
export const REGIONAL_INVOICE_TAX_CODE = `
function parseOrderTaxBreakdown(raw) {
  if (!raw) return null;
  var parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.lines)) return null;
  return parsed;
}

function regionalInvoiceRound(value, decimals) {
  var factor = decimals === 0 ? 1 : 100;
  var n = Number(value);
  return Math.round((isFinite(n) ? n : 0) * factor) / factor;
}

// items: the invoice lines as the route normalised them (productId, variantId,
// quantity, unitPrice, totalPrice — all stored, i.e. NET where tax is added on
// top and GROSS where it is included).
function resolveRegionalInvoiceTax(breakdown, items, discountAmount, shippingAmount) {
  var decimals = breakdown.taxDecimals === 0 ? 0 : 2;
  var standardRate = Number(breakdown.taxRate);
  if (!isFinite(standardRate) || standardRate < 0) standardRate = 0;
  var standardIncluded = breakdown.taxIncluded === true;
  var claimed = [];
  var itemTax = [];
  var goodsGross = 0;
  var goodsTax = 0;
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var match = null;
    for (var l = 0; l < breakdown.lines.length; l++) {
      var line = breakdown.lines[l];
      if (!line || claimed.indexOf(l) !== -1) continue;
      if (
        String(line.productId || '') === String(item.productId || '') &&
        String(line.variantId || '') === String(item.variantId || '')
      ) {
        match = line;
        claimed.push(l);
        break;
      }
    }
    var matchedRate = match ? Number(match.taxRate) : NaN;
    var rate = isFinite(matchedRate) && matchedRate >= 0 ? matchedRate : standardRate;
    var included = match ? match.taxIncluded === true : standardIncluded;
    var quantity = Number(item.quantity) || 1;
    var stored = Number(item.totalPrice) || 0;
    var lineGross = !included && rate > 0
      ? regionalInvoiceRound(
          regionalInvoiceRound((Number(item.unitPrice) || 0) * (1 + rate / 100), decimals) * quantity,
          decimals
        )
      : stored;
    var lineTax = included
      ? (rate > 0 ? stored - stored / (1 + rate / 100) : 0)
      : lineGross - stored;
    goodsGross += lineGross;
    goodsTax += lineTax;
    itemTax.push({ rate: rate, included: included, amount: regionalInvoiceRound(lineTax, decimals) });
  }

  var discount = discountAmount > 0 ? discountAmount : 0;
  var shipping = shippingAmount > 0 ? shippingAmount : 0;
  var goodsAfter = Math.max(0, goodsGross - discount);
  var goodsShare = goodsGross > 0 ? goodsAfter / goodsGross : 0;
  var shippingAfter = Math.max(0, shipping - Math.max(0, discount - goodsGross));
  var shippingShare = shipping > 0 ? shippingAfter / shipping : 0;
  var shippingTax = Number(breakdown.shippingTax);
  if (!isFinite(shippingTax) || shippingTax < 0) shippingTax = 0;
  var allocatedGoodsTax = goodsTax * goodsShare;
  var allocatedShippingTax = shippingTax * shippingShare;

  return {
    taxRate: standardRate,
    taxIncluded: standardIncluded,
    subtotal: goodsAfter - allocatedGoodsTax,
    taxAmount: allocatedGoodsTax + allocatedShippingTax,
    shippingNet: shippingAfter - allocatedShippingTax,
    total: goodsAfter + shippingAfter,
    itemTax: itemTax,
  };
}
`
