import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { ProductOptions } from '@teleporthq/teleport-shared'
import { REGIONAL_INVOICE_TAX_CODE } from './regional-invoice-tax-code'

/**
 * `utils/invoices/invoice-assembly.js` — turns an order, and whatever a caller
 * states over it, into the invoice the PDF is rendered from.
 *
 * Shared by `/api/invoices/generate` (the invoice issued when an order is paid)
 * and `/api/invoices/[id]/regenerate` (the same invoice rebuilt from the admin
 * panel), so a regenerated invoice is computed by exactly the code that issued
 * the original. Neither route prices, taxes or discounts anything itself.
 */
export const generateInvoiceAssemblyCode = (settings: UIDLInvoiceSettings): string => {
  const defaultTaxRate = settings.defaultTaxRate || 0
  const taxIncludedInPrice = settings.taxIncludedInPrice === true
  const templateDocumentJson = settings.template?.document
    ? JSON.stringify(settings.template.document)
    : 'null'

  return `/**
 * Invoice assembly — the order-to-invoice arithmetic and the PDF storage
 * helpers shared by the generate and regenerate routes.
 */

var dataAccess = require('./data-access');
var pdfGenerator = require('./pdf-generator');

var DEFAULT_TAX_RATE = ${defaultTaxRate};
var DEFAULT_CURRENCY = "USD";
var TAX_INCLUDED_IN_PRICE = ${taxIncludedInPrice};
var TEMPLATE_DOCUMENT = ${templateDocumentJson};
${REGIONAL_INVOICE_TAX_CODE}
${ProductOptions.generateProductOptionsHelperCode()}

// The product options an order line was bought with: the short one-line label
// (after the name) and every answer in full, one per line (the description).
// Same rule as the order emails: a current snapshot names its options, while
// the compact form older checkouts wrote names none, so its stored label reads
// better than its keys. Both '' for a line without options.
function invoiceLineOptions(row) {
  var snapshot = __poParseSnapshot(row.configuration);
  var storedLabel = String(row.configuration_label || '');
  var fromSnapshot =
    snapshot !== null && snapshot.entries.length > 0 && (snapshot.version === 1 || !storedLabel);
  return {
    label: storedLabel || (fromSnapshot ? __poLabel(snapshot.entries) : ''),
    description: fromSnapshot ? __poDetails(snapshot.entries) : storedLabel,
  };
}

var CURRENCY_SYMBOLS = {
  'USD': '$', 'EUR': '\\u20AC', 'GBP': '\\u00A3', 'JPY': '\\u00A5',
  'CAD': 'C$', 'AUD': 'A$', 'CHF': 'CHF ', 'CNY': '\\u00A5',
  'INR': '\\u20B9', 'BRL': 'R$', 'KRW': '\\u20A9', 'MXN': 'MX$',
  'SEK': 'kr', 'NOK': 'kr', 'DKK': 'kr', 'PLN': 'z\\u0142',
  'CZK': 'K\\u010D', 'HUF': 'Ft', 'RON': 'lei', 'BGN': 'лв',
  'HRK': 'kn', 'TRY': '\\u20BA', 'ZAR': 'R', 'SGD': 'S$',
  'HKD': 'HK$', 'NZD': 'NZ$', 'THB': '\\u0E3F', 'MYR': 'RM',
  'PHP': '\\u20B1', 'IDR': 'Rp', 'TWD': 'NT$', 'AED': 'AED',
  'SAR': 'SAR', 'ILS': '\\u20AA', 'EGP': 'E\\u00A3', 'NGN': '\\u20A6',
  'KES': 'KSh', 'GHS': 'GH\\u20B5', 'COP': 'COL$', 'ARS': 'AR$',
  'CLP': 'CLP$', 'PEN': 'S/.', 'VND': '\\u20AB', 'UAH': '\\u20B4',
};

function isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

// The origin this deployment calls its own routes on. A server-side self-call
// — the runtime-storage upload below — needs an absolute URL (Node's undici
// fetch rejects relative ones), and it carries the app secret, so it must
// never go to a host the request named: outside Vercel the Host header is
// whatever the caller sent. The rule of the server runtime's
// \`trustedBaseUrl\` (server-runtime-code.ts), inlined because this module must
// not depend on it: on Vercel the request's host (the domain Vercel routed to
// this deployment); elsewhere NEXTAUTH_URL's origin when it is set — except
// that a local server on another port than a local NEXTAUTH_URL keeps its own
// loopback address.
function requestBaseUrl(req) {
  var headers = (req && req.headers) || {};
  var host = headers.host || '';
  var proto = headers['x-forwarded-proto'] || (isLoopbackHost(host) ? 'http' : 'https');
  var requestOrigin = String(proto).split(',')[0].trim() + '://' + host;
  if (process.env.VERCEL) return requestOrigin;
  var configured = String(process.env.NEXTAUTH_URL || '').trim();
  if (!configured) return requestOrigin;
  var origin;
  try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
  if (isLoopbackHost(host) && isLoopbackHost(new URL(origin).host)) return requestOrigin;
  return origin;
}

// Runtime storage configuration. When all three are set, the generated PDF
// is also POSTed to the storage worker so consumers (e.g. the payment
// webhook) can store a persistent URL on the order record. Missing/invalid
// config silently skips the upload — the in-DB PDF (served via
// /api/invoices/[id]/pdf) is always available as a fallback.
// Uploads the rendered invoice PDF through THIS project's own
// \`/api/runtime-storage/upload\` route — the exact same path that the
// admin-panel asset uploader uses (client-side \`file-storage-upload\`
// workflow node → the same proxy). Centralising on that one route means:
//
//   1. The storage service URL + api key + project id live in one place
//      (the proxy), so invoice and admin uploads can never drift.
//   2. When runtime storage is not configured, the proxy returns
//      HTTP 500 with \`{ error: 'Runtime storage is not configured' }\`.
//      We surface that as the upload failure reason so the
//      \`invoice_pdf_url\` column stays empty instead of silently
//      holding a stale/fake URL.
//
// \`baseUrl\` is the live request origin (see \`requestBaseUrl\`). The
// self-fetch pattern is necessary because the routes run server-side, where
// Node's undici fetch rejects relative URLs.
async function uploadInvoicePdfToRuntimeStorage(pdfBuffer, fileName, baseUrl) {
  if (!baseUrl) {
    console.error('[invoice] Runtime storage: cannot compute proxy URL (baseUrl missing). Skipping upload.');
    return { storageUrl: '', error: 'baseUrl missing' };
  }
  if (typeof Blob === 'undefined' || typeof FormData === 'undefined' || typeof fetch === 'undefined') {
    console.error('[invoice] Runtime storage: Node runtime missing Blob/FormData/fetch (requires Node >= 18). Skipping upload.');
    return { storageUrl: '', error: 'node runtime too old' };
  }
  try {
    var proxyUrl = String(baseUrl).replace(/\\/+$/, '') + '/api/runtime-storage/upload';
    console.info('[invoice] Runtime storage: POST ' + proxyUrl + ' (' + pdfBuffer.length + ' bytes, fileName=' + fileName + ', folder=invoices)');
    var blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    var form = new FormData();
    form.append('file', blob, fileName);
    form.append('folder', 'invoices');
    // The upload route serves the store's own server code without the limits
    // it puts on a visitor's upload; only server code can present the secret.
    var res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: form,
    });
    var data = {};
    try { data = await res.json(); } catch (_parseErr) { data = {}; }
    if (!res.ok) {
      var reason = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      console.error('[invoice] Runtime storage: upload FAILED via proxy — ' + reason +
        ' (this is expected in dev when RUNTIME_STORAGE_URL / RUNTIME_STORAGE_API_KEY / RUNTIME_STORAGE_PROJECT_ID are unset in .env)');
      return { storageUrl: '', error: reason };
    }
    var files = Array.isArray(data.files) ? data.files : [];
    var first = files.length > 0 ? files[0] : null;
    var resolvedUrl = first && first.url ? String(first.url) : (data.url ? String(data.url) : '');
    var resolvedId = first && first.id ? String(first.id) : (data.id ? String(data.id) : '');
    if (resolvedUrl) {
      console.info('[invoice] Runtime storage: upload OK — fileId=' + (resolvedId || '(missing)') + ', storageUrl=' + resolvedUrl);
    } else {
      console.error('[invoice] Runtime storage: proxy returned 2xx but no url in payload — ' + JSON.stringify(data).slice(0, 500));
    }
    return { storageUrl: resolvedUrl, fileId: resolvedId };
  } catch (err) {
    console.error('[invoice] Runtime storage: upload threw — ' + (err && err.message));
    return { storageUrl: '', error: (err && err.message) || 'upload threw' };
  }
}

// Remembers which runtime-storage file holds the invoice's PDF, so a later
// regeneration can delete the copy it supersedes. A write of its own, after
// the URL is saved: a table without the column must never cost the invoice
// its PDF link.
async function recordStoredInvoicePdfKey(invoiceId, fileId) {
  try {
    await dataAccess.updateInvoice(invoiceId, { pdf_storage_key: fileId || null });
  } catch (err) {
    console.warn('[invoice] Could not record the PDF storage key for invoice ' + invoiceId + ': ' + (err && err.message));
  }
}

// Deletes a superseded copy of an invoice PDF from runtime storage, by the file
// id its upload returned. Best effort: with storage unconfigured, or the file
// already gone, there is nothing left to do — the invoice no longer points at
// it either way.
async function deleteStoredInvoicePdf(fileId) {
  var storageUrl = process.env.RUNTIME_STORAGE_URL;
  var apiKey = process.env.RUNTIME_STORAGE_API_KEY;
  var projectId = process.env.RUNTIME_STORAGE_PROJECT_ID;
  if (!fileId || !storageUrl || !apiKey || !projectId || typeof fetch === 'undefined') {
    return false;
  }
  try {
    var target = String(storageUrl).replace(/\\/+$/, '') + '/project/' + projectId + '/files/' + encodeURIComponent(String(fileId));
    var res = await fetch(target, { method: 'DELETE', headers: { Authorization: 'Bearer ' + apiKey } });
    if (!res.ok && res.status !== 404) {
      console.warn('[invoice] Runtime storage: could not delete the superseded PDF ' + fileId + ' (HTTP ' + res.status + ')');
      return false;
    }
    console.info('[invoice] Runtime storage: deleted the superseded PDF ' + fileId);
    return true;
  } catch (err) {
    console.warn('[invoice] Runtime storage: deleting the superseded PDF ' + fileId + ' threw — ' + (err && err.message));
    return false;
  }
}

// Everything an invoice is made of: the order it bills, and whatever the
// caller states over it — any body.* field the caller provides wins, the
// hydrated order fills the gaps. Returns null when there is not a single line
// to bill.
function assembleInvoiceData(body, hydratedOrder, hydratedItems) {
  var callerSuppliedItems = Array.isArray(body.items) && body.items.length > 0;

  var items = callerSuppliedItems
    ? body.items
    : hydratedItems.map(function (row) {
        var options = invoiceLineOptions(row);
        return {
          productId: row.product_id || row.productId || null,
          // Paired with \`productId\` to find the rate a line was charged at
          // on an order priced by region (see resolveRegionalInvoiceTax).
          variantId: row.variant_id || row.variantId || null,
          name: row.product_name || row.name || 'Item',
          variantLabel: row.variant_label || row.variantLabel || null,
          variantSwatches: row.variant_swatches || row.variantSwatches || null,
          configurationLabel: options.label,
          description: options.description,
          quantity: Number(row.quantity) || 1,
          unitPrice: Number(row.unit_price || row.unitPrice || row.price) || 0,
          totalPrice: Number(row.total_price || row.totalPrice) || 0,
          currency: row.currency || null,
        };
      });
  if (items.length === 0) {
    return null;
  }

  var currency = String(
    body.currency || (hydratedOrder && hydratedOrder.currency) || DEFAULT_CURRENCY
  ).toUpperCase();
  var currencySymbol = body.currencySymbol || CURRENCY_SYMBOLS[currency] || currency + ' ';

  var grossLineSum = 0;
  for (var i = 0; i < items.length; i++) {
    var qty = Number(items[i].quantity) || 1;
    var price = Number(items[i].unitPrice || items[i].unit_price || items[i].price) || 0;
    var itemTotal = Number(items[i].totalPrice || items[i].total_price) || (qty * price);
    items[i].totalPrice = itemTotal;
    items[i].unitPrice = price;
    items[i].quantity = qty;
    // An invoice bills in ONE currency, the order's: a stored line's own
    // column is never written by the checkout and holds its USD default.
    items[i].currency = currency;
    grossLineSum += itemTotal;
  }

  // Hydrated order row (or \`{}\` for a fully body-driven call), read before the
  // totals below need it. \`orderRow\` further down is the same object under a
  // name the customer/payment fallbacks use.
  var orderShippingSource = hydratedOrder || {};

  // Discounts.
  //
  // A discount STORED ON THE ORDER is money the buyer was not charged, so it
  // is always subtracted and always exposed to the template — hiding it would
  // print a total larger than the card was debited. A caller that assembled
  // the invoice itself (the manual/admin path) states its own figure and wins.
  //
  // The payment webhook calls this route with just an \`orderId\`, so the
  // order row — not the body — is the usual source.
  var discountAmount = 0;
  if (body.discountAmount != null && body.discountAmount !== '') {
    discountAmount = Number(body.discountAmount) || 0;
  } else if (orderShippingSource.discount_amount != null) {
    discountAmount = Number(orderShippingSource.discount_amount) || 0;
  }
  if (!(discountAmount > 0)) { discountAmount = 0; }

  // How the discount splits: the automatic rules' share is recorded beside
  // it, and the voucher's own share is recorded too since the discount
  // engine started splitting them (\`voucher_discount_amount\`) — derived as
  // the remainder on an order that predates that column.
  var automaticDiscountAmount = Number(
    body.automaticDiscountAmount != null
      ? body.automaticDiscountAmount
      : orderShippingSource.automatic_discount_amount
  );
  if (!(automaticDiscountAmount > 0)) { automaticDiscountAmount = 0; }
  if (automaticDiscountAmount > discountAmount) { automaticDiscountAmount = discountAmount; }
  var voucherDiscountSource = body.voucherDiscountAmount != null
    ? body.voucherDiscountAmount
    : orderShippingSource.voucher_discount_amount;
  var voucherDiscountAmount = voucherDiscountSource != null && voucherDiscountSource !== ''
    ? Number(voucherDiscountSource)
    : discountAmount - automaticDiscountAmount;
  if (!(voucherDiscountAmount > 0)) { voucherDiscountAmount = 0; }
  var voucherCode = String(body.voucherCode || orderShippingSource.voucher_code || '').trim();

  var taxRate = body.taxRate != null ? Number(body.taxRate) : DEFAULT_TAX_RATE;
  var subtotal;
  var taxAmount = 0;
  var taxableAmount;
  if (taxRate > 0 && TAX_INCLUDED_IN_PRICE) {
    // Prices already include VAT — extract net subtotal and tax out of the gross sum.
    taxableAmount = grossLineSum - discountAmount;
    var netAmount = taxableAmount / (1 + taxRate / 100);
    taxAmount = taxableAmount - netAmount;
    subtotal = netAmount;
  } else {
    subtotal = grossLineSum;
    taxableAmount = subtotal - discountAmount;
    if (taxRate > 0) {
      taxAmount = taxableAmount * (taxRate / 100);
    }
  }
  var goodsTotal = TAX_INCLUDED_IN_PRICE
    ? (grossLineSum - discountAmount)
    : (taxableAmount + taxAmount);

  // Delivery fee the buyer was charged. Read from the order (or handed in by
  // a caller that assembled the invoice itself) rather than re-derived from
  // the merchant's CURRENT delivery settings — the order is a historical
  // record and its settings may have changed since.
  //
  // It is added to the total but NOT into \`subtotal\` / \`taxAmount\`: those two
  // describe the GOODS, which is what \`teleport_invoice_items\` holds and what
  // the VAT breakdown is computed from. The storefront charges the configured
  // delivery price verbatim (\`computeShippingMeta\` never taxes it), so the
  // invoice must not tax it either — otherwise the invoice total stops
  // matching \`teleport_orders.total_amount\`, i.e. the amount actually taken.
  // 0 for pickup orders, free-delivery orders, and orders placed before the
  // column existed.
  var shippingAmount = Number(
    body.shippingAmount != null ? body.shippingAmount : (orderShippingSource.shipping_amount || 0)
  );
  if (!isFinite(shippingAmount) || shippingAmount < 0) {
    shippingAmount = 0;
  }
  var total = goodsTotal + shippingAmount;

  // An order priced by region records the rate each line was charged at, so
  // its invoice is computed from that record instead of the store default.
  // A caller that states its own \`taxRate\` keeps the single-rate path.
  var taxIncludedInPrice = TAX_INCLUDED_IN_PRICE;
  var regionalTaxBreakdown = body.taxRate == null
    ? parseOrderTaxBreakdown(orderShippingSource.tax_breakdown)
    : null;
  if (regionalTaxBreakdown) {
    var regionalTax = resolveRegionalInvoiceTax(regionalTaxBreakdown, items, discountAmount, shippingAmount);
    taxRate = regionalTax.taxRate;
    taxIncludedInPrice = regionalTax.taxIncluded;
    subtotal = regionalTax.subtotal;
    taxAmount = regionalTax.taxAmount;
    shippingAmount = regionalTax.shippingNet;
    total = regionalTax.total;
    for (var ti = 0; ti < items.length; ti++) {
      items[ti].taxRate = regionalTax.itemTax[ti].rate;
      items[ti].taxIncluded = regionalTax.itemTax[ti].included;
      items[ti].taxAmount = regionalTax.itemTax[ti].amount;
    }
  }

  // Cross-check against the amount the order was actually placed for. The
  // invoice is built from line items, the order carries the charged total,
  // and the two must agree — when they don't, the invoice is being written
  // from an incomplete set of lines (exactly what a lost race against
  // checkout's item loop looks like). Log-only: a mismatch must never stop
  // the merchant getting an invoice, but it has to be visible in the
  // function logs instead of silently shipping a short bill.
  var orderTotalAmount = Number(orderShippingSource.total_amount);
  if (isFinite(orderTotalAmount) && orderTotalAmount > 0 && Math.abs(orderTotalAmount - total) > 0.02) {
    console.warn('[invoice] Total mismatch for order ' + (body.orderId || '(none)') +
      ' — invoice total ' + (Math.round(total * 100) / 100) +
      ' vs teleport_orders.total_amount ' + orderTotalAmount +
      ' across ' + items.length + ' line item(s). The invoice may be missing lines.');
  }

  // The gift-card TENDER: the part of the total the buyer settled from a
  // card, so the provider (or the courier) collected the rest. Never a
  // discount — the total stays what the order was worth; only the amount
  // due moves, and it reaches 0.00 when the card covered everything.
  var giftCardAmount = Number(
    body.giftCardAmount != null ? body.giftCardAmount : (orderShippingSource.gift_card_amount || 0)
  );
  if (!isFinite(giftCardAmount) || giftCardAmount < 0) { giftCardAmount = 0; }
  var giftCardLast4 = String(body.giftCardLast4 || orderShippingSource.gift_card_last4 || '').trim();
  var roundedTotal = Math.round(total * 100) / 100;
  var roundedGiftCardAmount = Math.round(giftCardAmount * 100) / 100;
  var amountDue = Math.max(0, Math.round((roundedTotal - roundedGiftCardAmount) * 100) / 100);

  var issueDate = body.issueDate || new Date().toISOString().split('T')[0];
  var parsedIssueDate = new Date(issueDate);
  if (isNaN(parsedIssueDate.getTime())) {
    issueDate = new Date().toISOString().split('T')[0];
    parsedIssueDate = new Date(issueDate);
  }
  // \`dueDate\` defaults to issueDate + 30 days (industry-standard
  // Net 30 terms) when the caller doesn't pass one. Without this
  // default, every invoice generated from the order-notification /
  // payment-webhook paths shipped with an empty \`{{dueDate}}\` slot
  // in the buyer email + PDF — the merchant template literally
  // rendered "Due Date: " with no date — because none of those
  // callers know what payment terms the merchant uses.
  //
  // We compute it from \`parsedIssueDate\` (already validated above)
  // so a bad caller-provided \`issueDate\` doesn't propagate into a
  // bad \`dueDate\`. ISO yyyy-mm-dd is the same format the issueDate
  // path produces, so downstream date formatters get a single shape.
  var DEFAULT_DUE_DATE_OFFSET_DAYS = 30;
  var dueDate = body.dueDate || '';
  if (dueDate) {
    var parsedDue = new Date(dueDate);
    if (isNaN(parsedDue.getTime())) dueDate = '';
  }
  if (!dueDate) {
    var __defaultDue = new Date(parsedIssueDate.getTime());
    __defaultDue.setUTCDate(__defaultDue.getUTCDate() + DEFAULT_DUE_DATE_OFFSET_DAYS);
    dueDate = __defaultDue.toISOString().split('T')[0];
  }

  // Order-derived fallbacks. When the caller didn't pass a customer
  // field but the order has one, use it. Kept permissive on field
  // names (billing_* wins, falls back to shipping_*) because a buyer
  // who checked "bill to a different address" has both on the order.
  var orderRow = orderShippingSource;
  var fallbackCustomerName =
    orderRow.billing_name || orderRow.shipping_name || orderRow.customer_name || '';
  var fallbackCustomerEmail = orderRow.billing_email || orderRow.customer_email || '';
  var fallbackCustomerAddress = orderRow.billing_address || orderRow.shipping_address || '';
  var fallbackCustomerCity = orderRow.shipping_city || '';
  var fallbackCustomerState = orderRow.shipping_state || '';
  var fallbackCustomerZip = orderRow.shipping_zip || '';
  var fallbackCustomerCountry = orderRow.shipping_country || '';
  var fallbackPaymentMethod = orderRow.payment_method || '';
  var fallbackPaymentProvider = orderRow.payment_provider || '';
  var fallbackPaymentIntentId = orderRow.payment_intent_id || '';
  var fallbackNotes = orderRow.notes || '';

  var invoiceData = {
    id: body.id || require('crypto').randomUUID(),
    // Numbered by the route: an invoice issued at payment takes the next
    // number, a regenerated one keeps its own.
    invoiceNumber: '',
    status: body.status || 'issued',
    issueDate: issueDate,
    dueDate: dueDate,
    paidAt: body.paidAt || null,
    customerName: body.customerName || fallbackCustomerName || '',
    customerEmail: body.customerEmail || fallbackCustomerEmail || '',
    customerAddress: body.customerAddress || fallbackCustomerAddress || '',
    customerCity: body.customerCity || fallbackCustomerCity || '',
    customerState: body.customerState || fallbackCustomerState || '',
    customerZip: body.customerZip || fallbackCustomerZip || '',
    customerCountry: body.customerCountry || fallbackCustomerCountry || '',
    customerVat: body.customerVat || '',
    companyName: pdfGenerator.COMPANY_DETAILS.companyName || '',
    companyAddress: pdfGenerator.COMPANY_DETAILS.companyAddress || '',
    companyCity: pdfGenerator.COMPANY_DETAILS.companyCity || '',
    companyState: pdfGenerator.COMPANY_DETAILS.companyState || '',
    companyZip: pdfGenerator.COMPANY_DETAILS.companyZip || '',
    companyCountry: pdfGenerator.COMPANY_DETAILS.companyCountry || '',
    companyVat: pdfGenerator.COMPANY_DETAILS.companyVat || '',
    companyRegNumber: pdfGenerator.COMPANY_DETAILS.companyRegNumber || '',
    companyEmail: pdfGenerator.COMPANY_DETAILS.companyEmail || '',
    companyPhone: pdfGenerator.COMPANY_DETAILS.companyPhone || '',
    companyLogoUrl: body.companyLogoUrl || '',
    companyWebsite: pdfGenerator.COMPANY_DETAILS.companyWebsite || '',
    subtotal: Math.round(subtotal * 100) / 100,
    taxRate: taxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    // Surfacing the inclusion mode so the PDF builder can apply the SAME
    // formulas the GUI uses (invoice-vat-formulas.ts) when it derives
    // per-line unitPriceNet / lineVatAmount / lineTotalGross. Without
    // this flag the builder can't tell whether the stored unitPrice is
    // a net (added on top) or a gross (included in price) value, and
    // the line-item table renders blank cells.
    taxIncludedInPrice: taxIncludedInPrice,
    // The whole discount (vouchers and automatic rules), already subtracted
    // from \`total\`, plus how it splits and the code it came from — so the
    // template can print "Discount (SAVE20)" and gate the row on \`hasDiscount\`.
    discountAmount: Math.round(discountAmount * 100) / 100,
    voucherCode: voucherCode,
    voucherDiscountAmount: Math.round(voucherDiscountAmount * 100) / 100,
    automaticDiscountAmount: Math.round(automaticDiscountAmount * 100) / 100,
    hasDiscount: discountAmount > 0,
    // Delivery fee, surfaced so the PDF/HTML renderer can print its own line
    // and the merchant's template can bind \`invoice.shippingAmount\`.
    shippingAmount: Math.round(shippingAmount * 100) / 100,
    total: roundedTotal,
    // The gift-card tender and what is left to pay after it.
    giftCardAmount: roundedGiftCardAmount,
    giftCardLast4: giftCardLast4,
    hasGiftCard: roundedGiftCardAmount > 0,
    amountDue: amountDue,
    currency: currency,
    currencySymbol: currencySymbol,
    paymentMethod: body.paymentMethod || fallbackPaymentMethod || '',
    paymentProvider: body.paymentProvider || fallbackPaymentProvider || '',
    paymentIntentId: body.paymentIntentId || fallbackPaymentIntentId || '',
    orderId: body.orderId || '',
    // The subscription this order belongs to, for templates that say so.
    subscriptionId: body.subscriptionId || orderShippingSource.subscription_id || '',
    billingReason: body.billingReason || orderShippingSource.billing_reason || '',
    notes: body.notes || fallbackNotes || '',
    items: items,
    templateSnapshot: TEMPLATE_DOCUMENT ? JSON.stringify(TEMPLATE_DOCUMENT) : null,
  };

  return invoiceData;
}

module.exports = {
  requestBaseUrl: requestBaseUrl,
  uploadInvoicePdfToRuntimeStorage: uploadInvoicePdfToRuntimeStorage,
  recordStoredInvoicePdfKey: recordStoredInvoicePdfKey,
  deleteStoredInvoicePdf: deleteStoredInvoicePdf,
  assembleInvoiceData: assembleInvoiceData,
};
`
}
