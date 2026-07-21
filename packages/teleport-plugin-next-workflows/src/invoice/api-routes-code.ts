import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

export const generateInvoiceGenerateRouteCode = (settings: UIDLInvoiceSettings): string => {
  const prefix = settings.invoicePrefix || 'INV-'
  const defaultTaxRate = settings.defaultTaxRate || 0
  const showDiscount = settings.showDiscount === true
  const taxIncludedInPrice = settings.taxIncludedInPrice === true
  const autoGenerate = settings.autoGenerateOnPayment !== false
  const emailEnabled = settings.emailDelivery?.enabled === true
  const templateDocumentJson = settings.template?.document
    ? JSON.stringify(settings.template.document)
    : 'null'

  return `/**
 * POST /api/invoices/generate
 * Generates an invoice PDF, stores it in the database, optionally uploads it
 * to the runtime storage worker (when configured), and optionally sends it
 * via email.
 */

var dataAccess = require('../../../utils/invoices/data-access');
var pdfGenerator = require('../../../utils/invoices/pdf-generator');
${emailEnabled ? `var emailSender = require('../../../utils/invoices/email-sender');` : ''}

var INVOICE_PREFIX = ${JSON.stringify(prefix)};
var DEFAULT_TAX_RATE = ${defaultTaxRate};
var DEFAULT_CURRENCY = "USD";
var SHOW_DISCOUNT = ${showDiscount};
var TAX_INCLUDED_IN_PRICE = ${taxIncludedInPrice};
var TEMPLATE_DOCUMENT = ${templateDocumentJson};

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
// \`baseUrl\` is the live request origin (http://host:port) stamped at
// the top of \`handler\` from \`req.headers.host\`. The self-fetch pattern
// is necessary because this endpoint runs server-side, where Node's
// undici fetch rejects relative URLs.
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
    var res = await fetch(proxyUrl, { method: 'POST', body: form });
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Compute the live request origin once so \`uploadInvoicePdfToRuntimeStorage\`
  // can self-fetch the same \`/api/runtime-storage/upload\` route the admin-
  // panel uploader hits. Same header-parsing pattern as every other
  // generated api-route (see the workflow segment handlers).
  var __proto = req.headers['x-forwarded-proto'] ||
    (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
  var __baseUrl = __proto + '://' + req.headers.host;

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    console.info('[invoice] === /api/invoices/generate === baseUrl=' + __baseUrl);
    console.info('[invoice] Request received:', {
      orderId: body.orderId || null,
      hasBodyItems: Array.isArray(body.items) && body.items.length > 0,
      bodyItemCount: Array.isArray(body.items) ? body.items.length : 0,
      hasCustomerEmail: !!body.customerEmail,
      requestedCurrency: body.currency || null,
    });

    // Hydrate from teleport_orders + teleport_order_items when the caller
    // only supplied an \`orderId\`. The payment webhook's Process Payment
    // Webhook custom node goes through that path — it knows the order id
    // from Stripe/PayPal metadata but has no access to the buyer's
    // customer fields or cart line items at invoice-generation time.
    //
    // Hydrated values fill the gaps; any body.* field the caller did
    // provide wins, so hand-built admin-side calls (or future clients)
    // can still override the customer/company/notes/etc. without being
    // forced to round-trip the DB themselves.
    var hydratedOrder = null;
    var hydratedItems = [];
    if (body.orderId) {
      try {
        var hydrated = await dataAccess.getOrderWithItems(body.orderId);
        if (hydrated && hydrated.order) {
          hydratedOrder = hydrated.order;
          hydratedItems = Array.isArray(hydrated.items) ? hydrated.items : [];
          console.info('[invoice] Hydration OK — order=' + hydratedOrder.id + ', items=' + hydratedItems.length + ', currency=' + (hydratedOrder.currency || 'unset') + ', billing_name=' + (hydratedOrder.billing_name || '(empty)'));
        } else {
          console.info('[invoice] Hydration: orderId=' + body.orderId + ' not found in teleport_orders');
        }
      } catch (hydrateErr) {
        console.error('[invoice] Invoice generation: order hydration failed:', hydrateErr && hydrateErr.message);
      }
    } else {
      console.info('[invoice] No orderId in request — skipping DB hydration, using body.* fields verbatim');
    }

    var items = Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : hydratedItems.map(function (row) {
          return {
            productId: row.product_id || row.productId || null,
            name: row.product_name || row.name || 'Item',
            variantLabel: row.variant_label || row.variantLabel || null,
            variantSwatches: row.variant_swatches || row.variantSwatches || null,
            quantity: Number(row.quantity) || 1,
            unitPrice: Number(row.unit_price || row.unitPrice || row.price) || 0,
            totalPrice: Number(row.total_price || row.totalPrice) || 0,
            currency: row.currency || null,
          };
        });
    if (items.length === 0) {
      res.status(400).json({ error: 'At least one item is required' });
      return;
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
      grossLineSum += itemTotal;
    }

    var discountAmount = 0;
    if (SHOW_DISCOUNT && body.discountAmount) {
      discountAmount = Number(body.discountAmount) || 0;
    }

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
    var total = TAX_INCLUDED_IN_PRICE
      ? (grossLineSum - discountAmount)
      : (taxableAmount + taxAmount);

    var nextNumber = await dataAccess.getNextInvoiceNumber(INVOICE_PREFIX);
    var invoiceNumber = INVOICE_PREFIX + String(nextNumber).padStart(4, '0');

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
    var orderRow = hydratedOrder || {};
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
      invoiceNumber: invoiceNumber,
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
      taxIncludedInPrice: TAX_INCLUDED_IN_PRICE,
      discountAmount: Math.round(discountAmount * 100) / 100,
      total: Math.round(total * 100) / 100,
      currency: currency,
      currencySymbol: currencySymbol,
      paymentMethod: body.paymentMethod || fallbackPaymentMethod || '',
      paymentProvider: body.paymentProvider || fallbackPaymentProvider || '',
      paymentIntentId: body.paymentIntentId || fallbackPaymentIntentId || '',
      orderId: body.orderId || '',
      notes: body.notes || fallbackNotes || '',
      items: items,
      templateSnapshot: TEMPLATE_DOCUMENT ? JSON.stringify(TEMPLATE_DOCUMENT) : null,
    };

    var pdfBuffer = await pdfGenerator.generateInvoicePdf(invoiceData);
    console.info('[invoice] PDF generated: ' + pdfBuffer.length + ' bytes for ' + invoiceData.invoiceNumber);

    invoiceData.pdfData = pdfBuffer;
    invoiceData.pdfSizeBytes = pdfBuffer.length;
    invoiceData.pdfUrl = '/api/invoices/' + invoiceData.id + '/pdf';

    var insertedInvoice = await dataAccess.insertInvoice(invoiceData);
    await dataAccess.insertInvoiceItems(invoiceData.id, items);
    console.info('[invoice] DB insert OK — teleport_invoices.id=' + invoiceData.id + ', number=' + invoiceData.invoiceNumber + ', pdf_size_bytes=' + pdfBuffer.length + ', items=' + items.length + ' (accessible at ' + invoiceData.pdfUrl + ')');

    var safeFileName = String(invoiceNumber || invoiceData.id).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
    var uploadResult = await uploadInvoicePdfToRuntimeStorage(pdfBuffer, safeFileName, __baseUrl);
    var storageUrl = (uploadResult && uploadResult.storageUrl) || '';

    // Persist the runtime-storage URL onto \`teleport_invoices.pdf_url\` once
    // the upload succeeds. Before this, the row held the local fallback
    // (\`/api/invoices/<id>/pdf\`) which was set when \`insertInvoice\` ran
    // a few lines above. The fallback stays in place when storage is
    // unconfigured or the upload errored, so the invoice is always viewable
    // — either through runtime storage (public) or the DB fallback (auth).
    // Pairs with the payment webhook, which mirrors the same authoritative
    // URL onto \`teleport_orders.invoice_pdf_url\` so the order-details page
    // and the invoice admin panel both surface the same link.
    if (storageUrl) {
      try {
        await dataAccess.updateInvoice(invoiceData.id, { pdf_url: storageUrl });
        invoiceData.pdfUrl = storageUrl;
        console.info('[invoice] DB update OK — teleport_invoices.pdf_url=' + storageUrl + ' (id=' + invoiceData.id + ')');
      } catch (updateErr) {
        console.error('[invoice] DB update FAILED for pdf_url=' + storageUrl + ' (id=' + invoiceData.id + '): ' + (updateErr && updateErr.message));
      }
    } else {
      console.info('[invoice] Skipping pdf_url update — storage upload did not yield a URL; keeping DB fallback ' + invoiceData.pdfUrl);
    }

    // Mirror the invoice details onto the originating \`teleport_orders\`
    // row so the order-details page / orders-list / admin panel surface
    // the invoice number + PDF link without having to JOIN against
    // \`teleport_invoices\`. The payment webhooks (Stripe / PayPal) do
    // the same thing PLUS flip status/payment_status to confirmed/paid;
    // we deliberately do NOT touch those columns here because this
    // codepath also runs for cash-on-delivery (where payment_status
    // legitimately stays "pending" until the courier collects) and
    // for any future "generate invoice for an unpaid order" admin
    // flow. Idempotent — \`COALESCE\` keeps any pre-existing value
    // (e.g. when a webhook arrives second and re-runs us).
    if (body.orderId) {
      try {
        var __pg = require('pg');
        var __connStr = process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL || '';
        if (!__connStr) {
          console.error('[invoice] Cannot mirror onto teleport_orders — no DB connection string in env');
        } else {
          var __client = new __pg.Client({ connectionString: __connStr, ssl: __connStr.indexOf('sslmode=require') !== -1 ? { rejectUnauthorized: false } : undefined });
          try {
            await __client.connect();
            var __pdfUrl = storageUrl || invoiceData.pdfUrl || '';
            await __client.query(
              "UPDATE teleport_orders SET invoice_id = COALESCE(invoice_id, $1), invoice_number = COALESCE(invoice_number, $2), invoice_pdf_url = COALESCE(NULLIF(invoice_pdf_url, ''), NULLIF($3, '')), updated_at = NOW() WHERE id = $4",
              [invoiceData.id, invoiceNumber, __pdfUrl, body.orderId]
            );
            console.info('[invoice] teleport_orders mirror OK — orderId=' + body.orderId + ' invoiceNumber=' + invoiceNumber + ' invoice_pdf_url=' + (__pdfUrl || '(empty)'));
          } finally {
            try { await __client.end(); } catch (_e) {}
          }
        }
      } catch (__mirrorErr) {
        console.error('[invoice] teleport_orders mirror FAILED — orderId=' + body.orderId + ': ' + (__mirrorErr && __mirrorErr.message ? __mirrorErr.message : String(__mirrorErr)));
      }
    }

${
  emailEnabled
    ? `
    if (invoiceData.customerEmail) {
      try {
        var emailResult = await emailSender.sendInvoiceEmail(invoiceData, pdfBuffer);
        if (emailResult && emailResult.success) {
          console.info('[invoice] Email delivery OK — to=' + invoiceData.customerEmail + ', messageId=' + (emailResult.messageId || '(empty)'));
        } else {
          console.error('[invoice] Email delivery FAILED — to=' + invoiceData.customerEmail + ', error=' + (emailResult && emailResult.error ? emailResult.error : 'unknown'));
        }
      } catch (emailErr) {
        console.error('[invoice] Email delivery threw — to=' + invoiceData.customerEmail + ', error=' + (emailErr && emailErr.message ? emailErr.message : emailErr));
      }
    } else {
      console.info('[invoice] Skipping email delivery — invoiceData.customerEmail is empty. (Check teleport_orders.billing_email for order ' + (body.orderId || '(no orderId)') + ')');
    }
`
    : `
    console.info('[invoice] Email delivery not enabled for this project — skipping.');
`
}

    console.info('[invoice] === DONE — summary ===', {
      invoiceId: invoiceData.id,
      invoiceNumber: invoiceNumber,
      storageUrl: storageUrl || '(empty — upload failed; see earlier log for reason)',
      persistedPdfUrl: invoiceData.pdfUrl,
      total: invoiceData.total,
      currency: currency,
    });

    res.status(200).json({
      success: true,
      invoiceId: invoiceData.id,
      invoiceNumber: invoiceNumber,
      // Authoritative invoice URL — the URL the storage service returned after
      // the upload. This is the value the payment webhook writes onto
      // \`teleport_orders.invoice_pdf_url\`. Empty when runtime storage is
      // not configured; the webhook guards with a non-empty check.
      storageUrl: storageUrl || '',
      // DB-served fallback for accessing the PDF when runtime storage is
      // unavailable. The payment webhook does NOT persist this onto the
      // order — if you want an external URL you have to configure runtime
      // storage. Exposed here so admin UIs / tests can still view the PDF
      // in dev.
      pdfUrl: invoiceData.pdfUrl,
      total: invoiceData.total,
      currency: currency,
    });
  } catch (error) {
    console.error('[invoice] Generation threw:', error && error.stack ? error.stack : error);
    res.status(500).json({ success: false, error: error.message || 'Failed to generate invoice' });
  }
};
`
}

export const generateInvoicePdfRouteCode = (): string => {
  return `/**
 * GET /api/invoices/[id]/pdf
 * Returns the invoice PDF binary for download.
 */

var dataAccess = require('../../../../utils/invoices/data-access');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    var invoiceId = req.query.id;
    if (!invoiceId) {
      res.status(400).json({ error: 'Invoice ID is required' });
      return;
    }

    var invoice = await dataAccess.getInvoiceById(invoiceId);
    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    var pdfData = invoice.pdf_data;
    if (!pdfData) {
      res.status(404).json({ error: 'PDF not available for this invoice' });
      return;
    }

    var pdfBuffer;
    if (Buffer.isBuffer(pdfData)) {
      pdfBuffer = pdfData;
    } else if (typeof pdfData === 'string') {
      pdfBuffer = Buffer.from(pdfData, 'base64');
    } else {
      pdfBuffer = Buffer.from(pdfData);
    }
    var rawFilename = (invoice.invoice_number || 'invoice') + '.pdf';
    var safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + safeFilename + '"; filename*=UTF-8' + "'" + "'" + encodeURIComponent(rawFilename));
    res.setHeader('Content-Length', pdfBuffer.length);
    res.status(200).end(pdfBuffer);
  } catch (error) {
    console.error('Invoice PDF download error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to retrieve invoice PDF' });
  }
};
`
}
