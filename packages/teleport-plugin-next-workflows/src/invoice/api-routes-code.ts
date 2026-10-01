import { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generateCommonJsSessionTokenResolverCode } from '../session-cookie-resolver'
import { ROLE_OF_TOKEN_CODE } from '../workflow-auth-generator'

/**
 * The roles that act on invoices from a browser: the ones every generated
 * admin-panel page is protected with, since the admin panel is the only
 * browser that issues, rebuilds or lists every invoice.
 */
const INVOICE_ADMIN_ROLES = ['admin']

/**
 * Who is calling an invoice route, as ES5 source shared by the routes:
 * `invoiceCaller(req)` resolves to `{ server, signedIn, admin, userId }`.
 *
 * `server` is this deployment's own server code — the invoice node of a
 * payment webhook or a checkout segment, the payment webhooks — which presents
 * the app secret in `x-internal-data-secret`. Only server code can read
 * NEXTAUTH_SECRET, so a browser cannot forge it; it is compared in constant
 * time. Everyone else is who their session says they are.
 */
const INVOICE_CALLER_CODE = `${generateCommonJsSessionTokenResolverCode()}
${ROLE_OF_TOKEN_CODE}

var INVOICE_ADMIN_ROLES = ${JSON.stringify(INVOICE_ADMIN_ROLES)};

function presentsAppSecret(req) {
  var given = req && req.headers ? req.headers['x-internal-data-secret'] : '';
  var expected = process.env.NEXTAUTH_SECRET;
  if (typeof given !== 'string' || !given || !expected) return false;
  var a = Buffer.from(given);
  var b = Buffer.from(String(expected));
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}

async function invoiceCaller(req) {
  if (presentsAppSecret(req)) {
    return { server: true, signedIn: false, admin: false, userId: null };
  }
  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (err) {
    console.warn('[invoice] Could not read the session — ' + (err && err.message));
    token = null;
  }
  if (!token) {
    return { server: false, signedIn: false, admin: false, userId: null };
  }
  var role = roleOf(token);
  var userId = token.id != null ? token.id : token.sub;
  return {
    server: false,
    signedIn: true,
    admin: !!role && INVOICE_ADMIN_ROLES.indexOf(role) !== -1,
    userId: userId != null ? String(userId) : null,
  };
}`

export const generateInvoiceGenerateRouteCode = (settings: UIDLInvoiceSettings): string => {
  const prefix = settings.invoicePrefix || 'INV-'
  const autoGenerate = settings.autoGenerateOnPayment !== false
  const emailEnabled = settings.emailDelivery?.enabled === true

  return `/**
 * POST /api/invoices/generate
 * Generates an invoice PDF, stores it in the database, optionally uploads it
 * to the runtime storage worker (when configured), and optionally sends it
 * via email.
 *
 * Only the store itself issues invoices: its server code (the invoice node,
 * the payment webhooks — they present the app secret) or a signed-in admin.
 * An open route let anyone print invoices on the merchant's letterhead, burn
 * invoice numbers, claim an order's invoice for good, and read another
 * buyer's personal data back from a hydrated order.
 */

var dataAccess = require('../../../utils/invoices/data-access');
var pdfGenerator = require('../../../utils/invoices/pdf-generator');
var invoiceAssembly = require('../../../utils/invoices/invoice-assembly');
${
  emailEnabled
    ? `var emailSender = require('../../../utils/invoices/email-sender');
var sentEmailLog = require('../../../utils/email/sent-email-log');
var emailLocale = require('../../../utils/email/email-locale');`
    : ''
}

var INVOICE_PREFIX = ${JSON.stringify(prefix)};
// How long a reserved invoice may wait for its PDF before another request for
// the same order finishes it: longer than any one request lives.
var UNFINISHED_INVOICE_STALE_SECONDS = 900;

${INVOICE_CALLER_CODE}

// ---------------------------------------------------------------------------
// Waiting for the order's line items to be fully written.
//
// The checkout workflow writes the \`teleport_orders\` row first and then
// inserts \`teleport_order_items\` one HTTP round-trip at a time, so a caller
// that reaches this endpoint early can hydrate a HALF-WRITTEN order: a real
// 3-line order was once invoiced with a single line and a total 225.45 short
// of what the buyer was charged, because the other two rows were still in
// flight when the hydration query ran.
//
// So don't race it — wait for the order to settle, then hydrate. Two exit
// conditions, cheapest first:
//
//   1. \`teleport_orders.order_number\` is populated. Checkout backfills the
//      order number only AFTER the item loop has run to completion (the
//      settled branch does it in "Mark Order As Settled", the online-payment
//      branch in "Set Order Number Before Payment Redirect"), so a non-empty
//      order number proves every line has been written.
//   2. The row count is identical across \`SETTLE_STABLE_READS\` consecutive
//      reads — the fallback for orders written by a flow that never sets an
//      order number.
//
// An order that is already complete — every webhook-driven call, the
// checkout's own settled-branch call, and any hand-built admin call —
// satisfies (1) on the FIRST read, so the only request that ever pays for a
// poll is the one that would otherwise have shipped a wrong invoice.
var SETTLE_TIMEOUT_MS = 6000;
var SETTLE_POLL_MS = 400;
var SETTLE_STABLE_READS = 3;

function sleepMs(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function hydrateOrderWhenSettled(orderId) {
  var deadline = Date.now() + SETTLE_TIMEOUT_MS;
  var lastCount = -1;
  var repeats = 0;
  var attempts = 0;

  while (true) {
    var hydrated = await dataAccess.getOrderWithItems(orderId);
    attempts += 1;
    if (!hydrated || !hydrated.order) {
      // Nothing to wait for — the order id doesn't resolve. The caller logs
      // this as a miss and falls back to its own body.* fields.
      return hydrated;
    }

    var rows = Array.isArray(hydrated.items) ? hydrated.items : [];
    var count = rows.length;

    var orderNumber = hydrated.order.order_number;
    if (count > 0 && orderNumber != null && String(orderNumber).length > 0) {
      if (attempts > 1) {
        console.info('[invoice] Order ' + orderId + ' settled at ' + count + ' line(s) after ' + attempts + ' read(s) (order_number=' + orderNumber + ')');
      }
      return hydrated;
    }

    if (count === lastCount) {
      repeats += 1;
    } else {
      lastCount = count;
      repeats = 1;
    }
    if (count > 0 && repeats >= SETTLE_STABLE_READS) {
      console.info('[invoice] Order ' + orderId + ' settled at ' + count + ' line(s) — row count stable across ' + repeats + ' reads');
      return hydrated;
    }

    if (Date.now() >= deadline) {
      console.warn('[invoice] Order ' + orderId + ' did not settle within ' + SETTLE_TIMEOUT_MS +
        'ms — invoicing the ' + count + ' line(s) visible now');
      return hydrated;
    }

    await sleepMs(SETTLE_POLL_MS);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var caller = await invoiceCaller(req);
  if (!caller.server && !caller.admin) {
    res.status(caller.signedIn ? 403 : 401).json({
      success: false,
      error: caller.signedIn ? 'Only the store can issue invoices.' : 'Unauthenticated',
    });
    return;
  }

  // The live request origin, so the runtime-storage upload can self-fetch the
  // same \`/api/runtime-storage/upload\` route the admin-panel uploader hits.
  var __baseUrl = invoiceAssembly.requestBaseUrl(req);

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    var callerSuppliedItems = Array.isArray(body.items) && body.items.length > 0;

    console.info('[invoice] === /api/invoices/generate === baseUrl=' + __baseUrl);
    console.info('[invoice] Request received:', {
      orderId: body.orderId || null,
      hasBodyItems: callerSuppliedItems,
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
    //
    // The line items are read through \`hydrateOrderWhenSettled\`, which waits
    // for checkout to finish writing them — see the comment on that helper
    // for why an unguarded read snapshots a half-written order. A caller that
    // brought its own \`items\` array doesn't depend on the DB rows at all, so
    // that path takes the plain single read and skips the wait entirely.
    var hydratedOrder = null;
    var hydratedItems = [];
    if (body.orderId) {
      try {
        var hydrated = callerSuppliedItems
          ? await dataAccess.getOrderWithItems(body.orderId)
          : await hydrateOrderWhenSettled(body.orderId);
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

    // Lines, prices, discounts, tax, delivery and the gift-card tender — the
    // same assembly the admin panel's regenerate route rebuilds an invoice with.
    var invoiceData = invoiceAssembly.assembleInvoiceData(body, hydratedOrder, hydratedItems);
    if (!invoiceData) {
      res.status(400).json({ error: 'At least one item is required' });
      return;
    }
    var items = invoiceData.items;
    var currency = invoiceData.currency;

    // The number and the row are taken before the PDF is rendered, under one
    // lock (see reserveInvoice): an order gets one invoice however many times
    // its payment is reported, and no two invoices share a number.
    var reservation = await dataAccess.reserveInvoice(invoiceData, items, INVOICE_PREFIX);
    var held = reservation.invoice;
    if (!reservation.created) {
      if (Number(held.pdf_size_bytes) > 0) {
        console.info('[invoice] Order ' + body.orderId + ' already has invoice ' + held.invoice_number + ' — returning it');
        var heldPdfUrl = held.pdf_url || ('/api/invoices/' + held.id + '/pdf');
        res.status(200).json({
          success: true,
          alreadyIssued: true,
          invoiceId: held.id,
          invoiceNumber: held.invoice_number,
          storageUrl: heldPdfUrl.indexOf('/api/invoices/') === 0 ? '' : heldPdfUrl,
          pdfUrl: heldPdfUrl,
          total: Number(held.total) || 0,
          currency: held.currency || currency,
        });
        return;
      }
      // Reserved, never finished: another request is rendering it now, or the
      // one that reserved it died — then the first request to find it stale
      // finishes it under the same number.
      if (!(await dataAccess.claimStaleInvoice(held.id, UNFINISHED_INVOICE_STALE_SECONDS))) {
        console.info('[invoice] Order ' + body.orderId + ' invoice ' + held.invoice_number + ' is being issued by another request');
        res.status(409).json({ success: false, inProgress: true, error: "This order's invoice is being issued by another request." });
        return;
      }
      console.warn('[invoice] Finishing invoice ' + held.invoice_number + ' for order ' + body.orderId + ' — the request that reserved it never did');
      invoiceData.id = held.id;
      invoiceData.invoiceNumber = held.invoice_number;
    }
    var invoiceNumber = invoiceData.invoiceNumber;
${
  emailEnabled
    ? `
    // The language the invoice email goes out in: the one stamped on the
    // order at checkout (the buyer's storefront), else the one the caller
    // named, else the language of the request itself. A cron or a webhook
    // has neither of the last two and lands on the store's main language.
    var orderRow = hydratedOrder || {};
    var invoiceLocale = emailLocale.normalizeEmailLocale(orderRow.locale)
      || emailLocale.normalizeEmailLocale(body.locale)
      || emailLocale.resolveRequestLocale(req);
    invoiceData.locale = invoiceLocale;
`
    : ''
}

    var pdfBuffer = await pdfGenerator.generateInvoicePdf(invoiceData);
    console.info('[invoice] PDF generated: ' + pdfBuffer.length + ' bytes for ' + invoiceData.invoiceNumber);

    invoiceData.pdfUrl = '/api/invoices/' + invoiceData.id + '/pdf';
    await dataAccess.storeInvoicePdf(invoiceData.id, pdfBuffer, invoiceData.pdfUrl);
    console.info('[invoice] PDF stored — teleport_invoices.id=' + invoiceData.id + ', number=' + invoiceData.invoiceNumber + ', pdf_size_bytes=' + pdfBuffer.length + ', items=' + items.length + ' (accessible at ' + invoiceData.pdfUrl + ')');

    var safeFileName = String(invoiceNumber || invoiceData.id).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
    var uploadResult = await invoiceAssembly.uploadInvoicePdfToRuntimeStorage(pdfBuffer, safeFileName, __baseUrl);
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
      await invoiceAssembly.recordStoredInvoicePdfKey(invoiceData.id, uploadResult.fileId);
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

${
  emailEnabled
    ? `    // The email's ledger row is written in the background — land it before
    // replying, a serverless function may be frozen the instant it responds.
    await sentEmailLog.settleSentEmailLog();
`
    : ''
}    res.status(200).json({
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
${
  emailEnabled
    ? `    await sentEmailLog.settleSentEmailLog();
`
    : ''
}    // The error names the store's tables and data: server log only (above).
    res.status(500).json({ success: false, error: 'Failed to generate invoice' });
  }
};
`
}

/** The roles allowed to rebuild an invoice (the admin panel is the only caller). */
const REGENERATE_INVOICE_ROLES = INVOICE_ADMIN_ROLES

/**
 * POST /api/invoices/[id]/regenerate — the admin panel's "Regenerate" action.
 *
 * Rebuilds ONE invoice from its order with the very assembly that issued it at
 * payment (`utils/invoices/invoice-assembly.js`), IN PLACE: the same id, number,
 * dates and status, so the order, the sent-email ledger and any refund recorded
 * against it keep pointing at a valid invoice. What a merchant corrected on the
 * invoice itself (customer details, notes, payment method) wins over the order;
 * the lines and every figure are recomputed from the order. The old PDF is
 * replaced — and its runtime-storage copy deleted — and the customer is never
 * emailed.
 *
 * Unlike `/generate`, which the payment webhook calls server-to-server, this
 * route is reached from the merchant's browser only, so it checks the session
 * itself: signed in, with an admin role.
 */
export const generateInvoiceRegenerateRouteCode = (): string => {
  return `/**
 * POST /api/invoices/[id]/regenerate
 * Rebuilds one invoice from its order, in place, for the admin panel. Same
 * number, id and dates; a freshly rendered PDF replaces the old one; no email.
 */

var dataAccess = require('../../../../utils/invoices/data-access');
var pdfGenerator = require('../../../../utils/invoices/pdf-generator');
var invoiceAssembly = require('../../../../utils/invoices/invoice-assembly');

${generateCommonJsSessionTokenResolverCode()}
${ROLE_OF_TOKEN_CODE}

var REGENERATE_ALLOWED_ROLES = ${JSON.stringify(REGENERATE_INVOICE_ROLES)};

var MESSAGES = {
  unauthenticated: 'Your session has ended. Sign in again to regenerate invoices.',
  forbidden: 'Only an admin can regenerate invoices.',
  missingId: 'Invoice id is required.',
  notFound: 'This invoice no longer exists.',
  notLinked: 'This invoice is not linked to an order, so there is nothing to rebuild it from.',
  orderGone: 'The order this invoice was issued for no longer exists.',
  noLines: 'The order has no products left to invoice.',
  failed: 'The invoice could not be regenerated.',
  orderNotUpdated: 'The invoice was rebuilt, but its order could not be updated, so the customer still sees the previous PDF. Regenerate it again.',
};

// 'YYYY-MM-DD' of a stored date, the shape the assembly and the PDF expect.
// pg hands a DATE/TIMESTAMP over as a Date built from the naive column value
// in LOCAL time, so its local calendar day is the stored one; a string is cut
// to its date part. Empty when unreadable — the assembly then falls back
// exactly as it does at payment.
function calendarDate(value) {
  if (!value) return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    return value.getFullYear() + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
  }
  var match = /^(\\d{4}-\\d{2}-\\d{2})/.exec(String(value));
  return match ? match[1] : '';
}

// What the invoice itself says, stated over the order: the identity of the
// document (id, dates, status) and what a merchant can correct with Edit —
// the customer details, the notes and the payment method. Everything left out
// (the lines, prices, discounts, tax, delivery, gift card, currency) is read
// from the order, exactly as at payment. An empty field falls back to the
// order too.
function regenerationBody(invoice) {
  return {
    orderId: String(invoice.order_id),
    id: String(invoice.id),
    status: invoice.status || 'issued',
    issueDate: calendarDate(invoice.issue_date),
    dueDate: calendarDate(invoice.due_date),
    paidAt: invoice.paid_at || null,
    customerName: invoice.customer_name || '',
    customerEmail: invoice.customer_email || '',
    customerAddress: invoice.customer_address || '',
    customerCity: invoice.customer_city || '',
    customerState: invoice.customer_state || '',
    customerZip: invoice.customer_zip || '',
    customerCountry: invoice.customer_country || '',
    customerVat: invoice.customer_vat || '',
    paymentMethod: invoice.payment_method || '',
    paymentProvider: invoice.payment_provider || '',
    paymentIntentId: invoice.payment_intent_id || '',
    notes: invoice.notes || '',
  };
}

async function sessionRole(req) {
  try {
    var token = await __tqSessionToken(req);
    return token ? { signedIn: true, role: roleOf(token) } : { signedIn: false, role: null };
  } catch (err) {
    console.warn('[invoice] Regenerate: could not read the session — ' + (err && err.message));
    return { signedIn: false, role: null };
  }
}

// Postgres refuses an id that is not a UUID ("invalid_text_representation").
var MALFORMED_ID_ERROR_CODE = '22P02';

// A malformed id is a missing invoice; any other failure (an outage, a full
// pool) is a server error, never "this invoice no longer exists".
async function findInvoice(invoiceId) {
  try {
    return await dataAccess.getInvoiceById(invoiceId);
  } catch (err) {
    if (err && err.code === MALFORMED_ID_ERROR_CODE) return null;
    throw err;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  var session = await sessionRole(req);
  if (!session.signedIn) {
    res.status(401).json({ success: false, error: MESSAGES.unauthenticated });
    return;
  }
  if (!session.role || REGENERATE_ALLOWED_ROLES.indexOf(session.role) < 0) {
    res.status(403).json({ success: false, error: MESSAGES.forbidden });
    return;
  }

  var invoiceId = String((req.query && req.query.id) || '').trim();
  if (!invoiceId) {
    res.status(400).json({ success: false, error: MESSAGES.missingId });
    return;
  }

  try {
    var invoice = await findInvoice(invoiceId);
    if (!invoice) {
      res.status(404).json({ success: false, error: MESSAGES.notFound });
      return;
    }
    if (!invoice.order_id) {
      res.status(409).json({ success: false, error: MESSAGES.notLinked });
      return;
    }

    var hydrated = await dataAccess.getOrderWithItems(String(invoice.order_id));
    if (!hydrated || !hydrated.order) {
      res.status(409).json({ success: false, error: MESSAGES.orderGone });
      return;
    }

    var invoiceData = invoiceAssembly.assembleInvoiceData(
      regenerationBody(invoice),
      hydrated.order,
      Array.isArray(hydrated.items) ? hydrated.items : []
    );
    if (!invoiceData) {
      res.status(409).json({ success: false, error: MESSAGES.noLines });
      return;
    }
    invoiceData.invoiceNumber = String(invoice.invoice_number || '');

    // Rendered BEFORE anything is written: a PDF service that is down leaves
    // the invoice exactly as it was.
    var pdfBuffer = await pdfGenerator.generateInvoicePdf(invoiceData);
    invoiceData.pdfData = pdfBuffer;
    invoiceData.pdfSizeBytes = pdfBuffer.length;
    invoiceData.pdfUrl = '/api/invoices/' + invoiceData.id + '/pdf';

    await dataAccess.replaceInvoice(invoiceData.id, invoiceData, invoiceData.items);
    console.info('[invoice] Regenerated ' + invoiceData.invoiceNumber + ' (id=' + invoiceData.id + ', items=' + invoiceData.items.length + ', pdf_size_bytes=' + pdfBuffer.length + ')');

    // The new PDF's public copy. The row already serves the new bytes through
    // /api/invoices/<id>/pdf, so a failed upload costs nothing but the public URL.
    var previousStorageKey = invoice.pdf_storage_key ? String(invoice.pdf_storage_key) : '';
    var safeFileName = String(invoiceData.invoiceNumber || invoiceData.id).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
    var upload = await invoiceAssembly.uploadInvoicePdfToRuntimeStorage(pdfBuffer, safeFileName, invoiceAssembly.requestBaseUrl(req));
    var storedUrl = upload && upload.storageUrl ? String(upload.storageUrl) : '';
    var storageKey = storedUrl ? String(upload.fileId || '') : '';
    var pdfUrl = storedUrl || invoiceData.pdfUrl;

    // The order BEFORE the old copy goes: the customer's "View invoice" (their
    // profile, the order page) opens the order's link, so until it names the
    // new PDF the old copy must stay. On failure the new copy is dropped
    // instead and nothing else changes, so regenerating again starts clean.
    try {
      await dataAccess.linkOrderToInvoice(invoiceData.orderId, invoiceData.id, invoiceData.invoiceNumber, pdfUrl);
    } catch (linkErr) {
      console.error('[invoice] Regenerate: could not update order ' + invoiceData.orderId + ' — ' + (linkErr && linkErr.message));
      if (storageKey) {
        await invoiceAssembly.deleteStoredInvoicePdf(storageKey);
      }
      res.status(500).json({ success: false, error: MESSAGES.orderNotUpdated });
      return;
    }

    if (storedUrl) {
      try {
        await dataAccess.updateInvoice(invoiceData.id, { pdf_url: storedUrl });
      } catch (updateErr) {
        console.error('[invoice] Regenerate: could not save pdf_url=' + storedUrl + ' (id=' + invoiceData.id + '): ' + (updateErr && updateErr.message));
      }
    }
    invoiceData.pdfUrl = pdfUrl;
    if (storageKey !== previousStorageKey) {
      await invoiceAssembly.recordStoredInvoicePdfKey(invoiceData.id, storageKey);
    }
    if (previousStorageKey && previousStorageKey !== storageKey) {
      await invoiceAssembly.deleteStoredInvoicePdf(previousStorageKey);
    }

    res.status(200).json({
      success: true,
      invoiceId: invoiceData.id,
      invoiceNumber: invoiceData.invoiceNumber,
      pdfUrl: invoiceData.pdfUrl,
      total: invoiceData.total,
      currency: invoiceData.currency,
    });
  } catch (error) {
    console.error('[invoice] Regeneration threw:', error && error.stack ? error.stack : error);
    // The error names the store's tables and data: server log only (above).
    res.status(500).json({ success: false, error: MESSAGES.failed });
  }
};
`
}

/**
 * GET /api/invoices/[id]/pdf — the invoice PDF kept in the database, the link
 * an order shows when runtime storage is not configured.
 *
 * An invoice carries its buyer's name, address and what they bought, so it is
 * served to the order's own buyer (their session), a signed-in admin, or the
 * store's server code — and to nobody else, whoever knows the id. An invoice
 * someone may not read answers exactly like one that does not exist.
 */
export const generateInvoicePdfRouteCode = (): string => {
  return `/**
 * GET /api/invoices/[id]/pdf
 * Returns the invoice PDF binary for download, to its buyer or the store.
 */

var dataAccess = require('../../../../utils/invoices/data-access');

${INVOICE_CALLER_CODE}

// Postgres refuses an id that is not a UUID ("invalid_text_representation").
var MALFORMED_ID_ERROR_CODE = '22P02';

async function findInvoice(invoiceId) {
  try {
    return await dataAccess.getInvoiceById(invoiceId);
  } catch (err) {
    if (err && err.code === MALFORMED_ID_ERROR_CODE) return null;
    throw err;
  }
}

// The buyer of the invoice's order: the order row's owner, read from the order
// itself — an invoice's own customer fields are editable text.
async function isOrderOwner(invoice, userId) {
  if (!userId || !invoice || !invoice.order_id) return false;
  var hydrated = await dataAccess.getOrderWithItems(String(invoice.order_id));
  var owner = hydrated && hydrated.order ? hydrated.order.user_id : null;
  return owner != null && String(owner) === String(userId);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    var caller = await invoiceCaller(req);
    if (!caller.server && !caller.signedIn) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }

    var invoiceId = req.query.id;
    if (!invoiceId) {
      res.status(400).json({ error: 'Invoice ID is required' });
      return;
    }

    var invoice = await findInvoice(String(invoiceId));
    if (!invoice || (!caller.server && !caller.admin && !(await isOrderOwner(invoice, caller.userId)))) {
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
    // Personal data: never kept by a shared cache.
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(200).end(pdfBuffer);
  } catch (error) {
    // The error names the store's tables and data: server log only.
    console.error('Invoice PDF download error:', error);
    res.status(500).json({ success: false, error: 'Failed to retrieve invoice PDF' });
  }
};
`
}
