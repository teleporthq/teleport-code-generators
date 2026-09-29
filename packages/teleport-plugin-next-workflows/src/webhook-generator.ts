import {
  ProjectPluginStructure,
  FileType,
  UIDLInvoiceSettings,
  UIDLEcommerceSettings,
} from '@teleporthq/teleport-types'
import { ensurePaymentDriversModule, resolveStorePaymentDriverIds } from './payments'
import { DEFAULT_PAYMENT_DRIVER_IDS } from './payments/payment-drivers-scope'

/**
 * The origin a legacy webhook route calls this deployment's own routes on
 * (`/api/invoices/generate`, `/api/ecommerce/order-notification`). Those
 * self-calls carry the app secret, so the origin must never be a host the
 * request named — outside Vercel the Host header is whatever the caller sent.
 * The rule of the server runtime's `trustedBaseUrl` (server-runtime-code.ts),
 * inlined because these routes do not load the server runtime: on Vercel the
 * request's host (the domain Vercel routed to this deployment); elsewhere
 * NEXTAUTH_URL's origin when it is set — except that a local server on another
 * port than a local NEXTAUTH_URL keeps its own loopback address (NEXTAUTH_URL
 * stuck at :3000 while `next dev` runs on :3001). With no Host header at all,
 * the configured URLs as before.
 */
const WEBHOOK_BASE_URL_CODE = `function __isLoopbackHost(host) {
  var name = String(host || '').replace(/:[0-9]+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

function __webhookBaseUrl(req) {
  var headers = (req && req.headers) || {};
  var host = headers.host || '';
  if (!host) {
    var envBaseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || '';
    if (envBaseUrl && !envBaseUrl.startsWith('http')) envBaseUrl = 'https://' + envBaseUrl;
    return envBaseUrl || 'http://localhost:3000';
  }
  var proto = headers['x-forwarded-proto'] || (__isLoopbackHost(host) ? 'http' : 'https');
  var requestOrigin = String(proto).split(',')[0].trim() + '://' + host;
  if (process.env.VERCEL) return requestOrigin;
  var configured = String(process.env.NEXTAUTH_URL || '').trim();
  if (!configured) return requestOrigin;
  var origin;
  try { origin = new URL(configured).origin; } catch (e) { return requestOrigin; }
  if (__isLoopbackHost(host) && __isLoopbackHost(new URL(origin).host)) return requestOrigin;
  return origin;
}`

export const generateStripeWebhookCode = (
  invoiceSettings: UIDLInvoiceSettings | undefined,
  ecommerceSettings?: UIDLEcommerceSettings
): string => {
  const autoGenerateInvoice = invoiceSettings?.enabled && invoiceSettings?.autoGenerateOnPayment
  const hasEcommerce = !!ecommerceSettings
  const hasOrderNotifications = hasEcommerce && ecommerceSettings.orderNotifications

  return `/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events for payment processing.
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch');
}

${
  autoGenerateInvoice
    ? `var invoiceGenerate;
try { invoiceGenerate = require('../invoices/generate'); } catch (e) { invoiceGenerate = null; }
`
    : ''
}

var __paymentDrivers;
try { __paymentDrivers = require('../../../utils/payments'); } catch (e) { __paymentDrivers = null; }

// The key is read the way the store's payment drivers read it: the deployed
// name, then the secret the editor saved it under (an older store's
// STRIPE_TEST_KEY last).
function __stripeSecretKey() {
  return __paymentDrivers.core.credential('stripe', 'secretKey', ['STRIPE_TEST_KEY']);
}
${
  autoGenerateInvoice || hasOrderNotifications
    ? `
// Stripe reports money in the currency's smallest unit (JPY has none, KWD a
// thousandth); the store keeps the major one, converted as its drivers do.
function __stripeMajor(minor, currency) {
  return __paymentDrivers.core.fromMinor(Number(minor) || 0, currency);
}
`
    : ''
}
${WEBHOOK_BASE_URL_CODE}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // This deployment's own origin for the self-calls (invoice generation, order
  // notification), which carry the app secret — never a host the request named.
  var __baseUrl = __webhookBaseUrl(req);

  // Verified by the store's Stripe driver: the signature when a signing
  // secret is configured, else the event read back from Stripe — never the
  // request as it arrived. Without the driver nothing can be verified.
  var driver = __paymentDrivers ? __paymentDrivers.get('stripe') : null;
  if (!driver) {
    console.error('Stripe webhook rejected: this store has no Stripe payment driver');
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  var stripeSecretKey = __stripeSecretKey();

  if (!stripeSecretKey) {
    res.status(500).json({ error: 'Stripe secret key not configured' });
    return;
  }

  try {
    var rawBody = await getRawBody(req);
    var parsed;
    try { parsed = JSON.parse(rawBody.toString('utf-8')); } catch (_e) { parsed = {}; }
    var verification = await driver.verifyWebhook({ headers: req.headers, rawBody: rawBody, body: parsed, secret: '' });
    if (!verification.ok) {
      console.error('Stripe webhook rejected: ' + (verification.reason || 'not verified'));
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }
    var event = verification.body;

    switch (event.type) {
      // A bank debit or a transfer completes the session UNPAID, and Stripe
      // reports the money later (or never): only a paid session pays the order.
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.completed': {
        var session = event.data.object;
        if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
          console.log('Checkout session completed, payment not received yet:', session.id);
          break;
        }
        ${
          autoGenerateInvoice
            ? `await handleInvoiceGeneration(session, 'checkout', __baseUrl, stripeSecretKey);`
            : `console.log('Checkout session completed:', session.id);`
        }
        ${!autoGenerateInvoice && hasEcommerce ? `await handleEcommerceOrderUpdate(session);` : ''}
        ${hasOrderNotifications ? `await sendOrderNotification(session, __baseUrl);` : ''}
        break;
      }

      case 'payment_intent.succeeded': {
        var paymentIntent = event.data.object;
        // The PaymentIntent of the store's own Checkout Session carries the
        // order in its metadata (the driver copies it there so a refund names
        // the order): the session's event pays and invoices that order, and
        // this one would do it a second time.
        if (paymentIntent.metadata && paymentIntent.metadata.orderId) {
          console.log('Payment intent succeeded for a checkout session order:', paymentIntent.id);
          break;
        }
        ${
          autoGenerateInvoice
            ? `// An intent that pays a Stripe invoice (a subscription's first
        // payment, a renewal) is invoiced from invoice.payment_succeeded,
        // with the invoice's own lines: invoiced here too, it would be twice.
        if (await __paysStripeInvoice(paymentIntent, stripeSecretKey)) {
          console.log('Payment intent succeeded for a Stripe invoice:', paymentIntent.id);
          break;
        }`
            : ''
        }
        ${
          autoGenerateInvoice
            ? `await handleInvoiceGeneration(paymentIntent, 'payment_intent', __baseUrl, stripeSecretKey);`
            : `console.log('Payment intent succeeded:', paymentIntent.id);`
        }
        break;
      }

      case 'customer.subscription.created': {
        var subscription = event.data.object;
        console.log('Subscription created:', subscription.id);
        break;
      }

      case 'customer.subscription.deleted': {
        var cancelledSub = event.data.object;
        console.log('Subscription cancelled:', cancelledSub.id);
        break;
      }

      case 'invoice.payment_succeeded': {
        var stripeInvoice = event.data.object;
        ${
          autoGenerateInvoice
            ? `// A subscription's first invoice, from a checkout the store opened
        // for an order, is invoiced from that checkout's own event with the
        // order it pays: invoiced here too, it would be twice.
        if (__opensStoreOrder(stripeInvoice)) {
          console.log('Invoice payment succeeded for a store checkout order:', stripeInvoice.id);
          break;
        }
        await handleStripeInvoicePayment(stripeInvoice, __baseUrl);`
            : `console.log('Invoice payment succeeded:', stripeInvoice.id);`
        }
        break;
      }

      default:
        console.log('Unhandled Stripe event type:', event.type);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error);
    res.status(500).json({ error: error.message || 'Webhook processing failed' });
  }
};

function getRawBody(req) {
  return new Promise(function(resolve, reject) {
    if (req.body && Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() { resolve(Buffer.concat(chunks)); });
    req.on('error', function(err) { reject(err); });
  });
}

module.exports.config = { api: { bodyParser: false } };

${autoGenerateInvoice ? generateInvoiceHandlerCode() : ''}
${hasEcommerce ? generateEcommerceOrderUpdateCode() : ''}
${hasOrderNotifications ? generateOrderNotificationWebhookCode() : ''}
`
}

function generateEcommerceOrderUpdateCode(): string {
  // Used ONLY when invoice auto-generation is OFF — when invoices are on,
  // handleInvoiceGeneration calls __linkInvoiceToOrder which does the same
  // mark-paid update plus invoice linkage, so this function is skipped to
  // avoid two writes that race for the row.
  return `
async function handleEcommerceOrderUpdate(session) {
  try {
    var orderId = session.metadata && session.metadata.orderId;
    if (!orderId) return;
    var connStr = process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL || '';
    if (!connStr) return;
    var pg = require('pg');
    var client = new pg.Client({ connectionString: connStr, ssl: connStr.indexOf('sslmode=require') !== -1 ? { rejectUnauthorized: false } : undefined });
    try {
      await client.connect();
      // A cancelled order stays cancelled, whatever pays for it late.
      await client.query(
        "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), updated_at = NOW() WHERE id = $4 AND status IS DISTINCT FROM 'cancelled'",
        ['paid', 'paid', String(session.payment_intent || session.id || ''), orderId]
      );
    } finally {
      try { await client.end(); } catch (_e) {}
    }
  } catch (err) {
    console.error('Failed to update ecommerce order:', err.message);
  }
}
`
}

function generateOrderNotificationWebhookCode(): string {
  return `
async function sendOrderNotification(session, baseUrl) {
  try {
    var orderId = session.metadata && session.metadata.orderId;
    var resolvedBaseUrl = baseUrl || process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    if (resolvedBaseUrl && !resolvedBaseUrl.startsWith('http')) resolvedBaseUrl = 'https://' + resolvedBaseUrl;

    await fetch(resolvedBaseUrl + '/api/ecommerce/order-notification', {
      method: 'POST',
      // The route emails the merchant only for the store's own server code.
      headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify({
        orderId: orderId || session.id,
        customerEmail: session.customer_email || (session.customer_details && session.customer_details.email) || '',
        customerName: (session.customer_details && session.customer_details.name) || '',
        totalAmount: __stripeMajor(session.amount_total, session.currency),
        paymentMethod: 'stripe',
      }),
    });
  } catch (err) {
    console.error('Failed to send order notification:', err.message);
  }
}
`
}

function generateInvoiceHandlerCode(): string {
  return `
async function handleInvoiceGeneration(paymentObj, source, baseUrl, stripeSecretKey) {
  try {
    var customerEmail = '';
    var customerName = '';
    var items = [];
    var currency = 'usd';
    var paymentIntentId = paymentObj.id || '';
    // For checkout sessions, the place-order workflow embeds the internal
    // teleport_orders UUID in metadata.orderId. A payment_intent.succeeded
    // event reaches here only for an intent that names no order (one the
    // store's checkout opened is settled by its session's event), so '' then
    // skips hydration cleanly.
    var internalOrderId = (paymentObj.metadata && typeof paymentObj.metadata.orderId === 'string') ? paymentObj.metadata.orderId : '';

    if (source === 'checkout') {
      customerEmail = paymentObj.customer_email || (paymentObj.customer_details && paymentObj.customer_details.email) || '';
      customerName = (paymentObj.customer_details && paymentObj.customer_details.name) || '';
      currency = paymentObj.currency || 'usd';

      if (paymentObj.line_items && paymentObj.line_items.data) {
        items = paymentObj.line_items.data.map(function(li) {
          return {
            name: li.description || '',
            quantity: li.quantity || 1,
            unitPrice: __stripeMajor(li.amount_total, currency) / (li.quantity || 1),
            totalPrice: __stripeMajor(li.amount_total, currency),
            currency: currency.toUpperCase(),
          };
        });
      } else if (stripeSecretKey && paymentObj.id) {
        try {
          var params = new URLSearchParams();
          params.append('expand[]', 'line_items');
          var sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions/' + paymentObj.id + '?' + params.toString(), {
            headers: { 'Authorization': 'Bearer ' + stripeSecretKey },
          });
          var sessionData = await sessionRes.json();
          if (sessionData.line_items && sessionData.line_items.data) {
            items = sessionData.line_items.data.map(function(li) {
              return {
                name: li.description || '',
                quantity: li.quantity || 1,
                unitPrice: __stripeMajor(li.amount_total, currency) / (li.quantity || 1),
                totalPrice: __stripeMajor(li.amount_total, currency),
                currency: currency.toUpperCase(),
              };
            });
          }
        } catch (e) { console.error('Failed to fetch session line items:', e.message); }
      }

      paymentIntentId = paymentObj.payment_intent || paymentObj.id;
    } else if (source === 'payment_intent') {
      currency = paymentObj.currency || 'usd';
      paymentIntentId = paymentObj.id;
      items = [{
        name: paymentObj.description || 'Payment',
        quantity: 1,
        unitPrice: __stripeMajor(paymentObj.amount, currency),
        totalPrice: __stripeMajor(paymentObj.amount, currency),
        currency: currency.toUpperCase(),
      }];

      if (stripeSecretKey && paymentObj.customer) {
        try {
          var custRes = await fetch('https://api.stripe.com/v1/customers/' + paymentObj.customer, {
            headers: { 'Authorization': 'Bearer ' + stripeSecretKey },
          });
          var custData = await custRes.json();
          customerEmail = custData.email || '';
          customerName = custData.name || '';
        } catch (e) { console.error('Failed to fetch customer:', e.message); }
      }
    }

    var resolvedBaseUrl = baseUrl || process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    if (resolvedBaseUrl && !resolvedBaseUrl.startsWith('http')) resolvedBaseUrl = 'https://' + resolvedBaseUrl;

    var invoicePayload = {
      customerName: customerName,
      customerEmail: customerEmail,
      items: items,
      currency: currency.toUpperCase(),
      paymentMethod: 'card',
      paymentProvider: 'stripe',
      paymentIntentId: paymentIntentId,
      orderId: internalOrderId || paymentIntentId,
      status: 'paid',
      paidAt: new Date().toISOString(),
    };

    // When we resolved the internal order id, drop the synthesized items so
    // /api/invoices/generate hydrates real line items + billing fields from
    // teleport_order_items / teleport_orders. Same rationale as the PayPal
    // handler — the buyer-visible invoice shows the actual cart contents.
    if (internalOrderId) {
      delete invoicePayload.items;
    }

    var response = await fetch(resolvedBaseUrl + '/api/invoices/generate', {
      method: 'POST',
      // The route issues invoices only for the store's own server code, which
      // presents the app secret.
      headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify(invoicePayload),
    });

    if (!response.ok) {
      var errBody = await response.json().catch(function() { return {}; });
      console.error('Invoice generation failed:', errBody.error || response.statusText);
      return;
    }

    if (internalOrderId) {
      try {
        var invoiceResp = await response.json().catch(function() { return {}; });
        await __linkInvoiceToOrder(internalOrderId, invoiceResp, paymentIntentId);
      } catch (linkErr) {
        console.error('Stripe webhook: failed to mirror invoice onto order ' + internalOrderId + ': ' + (linkErr && linkErr.message));
      }
    }
  } catch (err) {
    console.error('Failed to generate invoice from webhook:', err.message);
  }
}

// Same direct-pg pattern as the PayPal webhook — keeps both providers
// consistent and avoids needing the workflow's data-source UUID at codegen
// time. Connection string is the one every generated DB route already reads.
async function __linkInvoiceToOrder(internalOrderId, invoiceResp, paymentIntentId) {
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL || '';
  if (!connStr) {
    console.error('Stripe webhook: cannot mirror invoice — no DB connection string in env');
    return;
  }
  var pg;
  try {
    pg = require('pg');
  } catch (e) {
    console.error('Stripe webhook: pg module unavailable, skipping order mirror: ' + e.message);
    return;
  }
  var client = new pg.Client({ connectionString: connStr, ssl: connStr.indexOf('sslmode=require') !== -1 ? { rejectUnauthorized: false } : undefined });
  try {
    await client.connect();
    var pdfUrl = (invoiceResp && (invoiceResp.storageUrl || invoiceResp.pdfUrl)) || '';
    var invoiceId = (invoiceResp && invoiceResp.invoiceId) || null;
    var invoiceNumber = (invoiceResp && invoiceResp.invoiceNumber) || null;
    // status / payment_status are independent: status tracks the order
    // lifecycle (confirmed = order accepted), payment_status tracks money. A
    // cancelled order stays cancelled, whatever pays for it late.
    await client.query(
      "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), invoice_id = COALESCE($4, invoice_id), invoice_number = COALESCE($5, invoice_number), invoice_pdf_url = COALESCE(NULLIF($6, ''), invoice_pdf_url), updated_at = NOW() WHERE id = $7 AND status IS DISTINCT FROM 'cancelled'",
      ['confirmed', 'paid', paymentIntentId || '', invoiceId, invoiceNumber, pdfUrl, internalOrderId]
    );
    console.info('[stripe webhook] order ' + internalOrderId + ' marked confirmed/paid — invoice=' + (invoiceNumber || '(none)') + ' pdf=' + (pdfUrl || '(none)'));
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

// Whether a subscription's invoice is the first one of a subscription the
// store's own Checkout Session opened for an order. The session copies the
// order onto the subscription's metadata, which Stripe snapshots onto each
// invoice — on the invoice itself in the classic API, under \`parent\` from the
// 2025-03-31 versions on.
function __opensStoreOrder(stripeInvoice) {
  if (!stripeInvoice || stripeInvoice.billing_reason !== 'subscription_create') {
    return false;
  }
  var details = stripeInvoice.subscription_details ||
    (stripeInvoice.parent && stripeInvoice.parent.subscription_details) || {};
  var metadata = details.metadata || {};
  return typeof metadata.orderId === 'string' && metadata.orderId !== '';
}

// Whether a PaymentIntent pays a Stripe invoice. The classic API names the
// invoice on the intent; from the 2025-03-31 versions on the intent names none,
// and the invoice payments are searched by the intent instead (that search is
// pinned to the version that introduced it). A search Stripe does not answer
// fails the delivery, so Stripe sends it again: taken as a payment of its own,
// an invoice's payment would be invoiced twice.
async function __paysStripeInvoice(paymentIntent, stripeSecretKey) {
  if (paymentIntent.invoice) {
    return true;
  }
  if (!stripeSecretKey || !paymentIntent.id) {
    return false;
  }
  try {
    var params = new URLSearchParams();
    params.append('payment[type]', 'payment_intent');
    params.append('payment[payment_intent]', paymentIntent.id);
    params.append('limit', '1');
    var found = await fetch('https://api.stripe.com/v1/invoice_payments?' + params.toString(), {
      headers: { 'Authorization': 'Bearer ' + stripeSecretKey, 'Stripe-Version': '2025-03-31.basil' },
    });
    if (!found.ok) {
      throw new Error('Stripe answered ' + found.status);
    }
    var page = await found.json();
    return !!(page && Array.isArray(page.data) && page.data.length > 0);
  } catch (e) {
    console.error('Failed to look up the invoice of payment intent ' + paymentIntent.id + ':', e.message);
    throw new Error('Could not tell whether payment intent ' + paymentIntent.id + ' pays a Stripe invoice');
  }
}

async function handleStripeInvoicePayment(stripeInvoice, baseUrl) {
  try {
    var items = [];
    if (stripeInvoice.lines && stripeInvoice.lines.data) {
      items = stripeInvoice.lines.data.map(function(li) {
        return {
          name: li.description || '',
          quantity: li.quantity || 1,
          unitPrice: __stripeMajor(li.amount, stripeInvoice.currency),
          totalPrice: __stripeMajor(li.amount, stripeInvoice.currency),
          currency: (stripeInvoice.currency || 'usd').toUpperCase(),
        };
      });
    }

    var resolvedBaseUrl = baseUrl || process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    if (resolvedBaseUrl && !resolvedBaseUrl.startsWith('http')) resolvedBaseUrl = 'https://' + resolvedBaseUrl;

    var invoicePayload = {
      customerName: stripeInvoice.customer_name || '',
      customerEmail: stripeInvoice.customer_email || '',
      items: items,
      currency: (stripeInvoice.currency || 'usd').toUpperCase(),
      paymentMethod: 'card',
      paymentProvider: 'stripe',
      paymentIntentId: stripeInvoice.payment_intent || '',
      paymentProviderInvoiceId: stripeInvoice.id || '',
      status: 'paid',
      paidAt: new Date().toISOString(),
    };

    var response = await fetch(resolvedBaseUrl + '/api/invoices/generate', {
      method: 'POST',
      // The route issues invoices only for the store's own server code, which
      // presents the app secret.
      headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify(invoicePayload),
    });

    if (!response.ok) {
      var errBody = await response.json().catch(function() { return {}; });
      console.error('Invoice generation failed:', errBody.error || response.statusText);
    }
  } catch (err) {
    console.error('Failed to generate invoice from Stripe invoice event:', err.message);
  }
}
`
}

export const generatePaypalWebhookCode = (
  invoiceSettings: UIDLInvoiceSettings | undefined,
  ecommerceSettings?: UIDLEcommerceSettings
): string => {
  const autoGenerateInvoice = invoiceSettings?.enabled && invoiceSettings?.autoGenerateOnPayment
  const hasOrderNotifications = !!ecommerceSettings && ecommerceSettings.orderNotifications

  return `/**
 * POST /api/webhooks/paypal
 * Handles PayPal webhook events for payment processing.
 */
if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch');
}

${
  autoGenerateInvoice
    ? `var invoiceGenerate;
try { invoiceGenerate = require('../invoices/generate'); } catch (e) { invoiceGenerate = null; }
`
    : ''
}

var __paymentDrivers;
try { __paymentDrivers = require('../../../utils/payments'); } catch (e) { __paymentDrivers = null; }

// The credentials are read the way the store's payment drivers read them:
// the deployed name, then the secret the editor saved them under.
function __paypalCredential(field) {
  return __paymentDrivers.core.credential('paypal', field);
}

${WEBHOOK_BASE_URL_CODE}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Verified by the store's PayPal driver: PayPal's signature check when a
  // webhook id is configured, else the event read back from PayPal — never
  // the request as it arrived. Without the driver nothing can be verified.
  var driver = __paymentDrivers ? __paymentDrivers.get('paypal') : null;
  if (!driver) {
    console.error('PayPal webhook rejected: this store has no PayPal payment driver');
    res.status(400).json({ error: 'Invalid webhook signature' });
    return;
  }

  var clientId = __paypalCredential('clientId');
  var clientSecret = __paypalCredential('clientSecret');

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'PayPal credentials not configured' });
    return;
  }

  // This deployment's own origin for the self-calls (invoice generation, order
  // notification), which carry the app secret — never a host the request named.
  var __baseUrl = __webhookBaseUrl(req);

  try {
    var rawBody = await getRawBody(req);
    var parsed;
    try { parsed = JSON.parse(rawBody.toString('utf-8')); } catch (_e) { parsed = {}; }
    var verification = await driver.verifyWebhook({ headers: req.headers, rawBody: rawBody, body: parsed, secret: '' });
    if (!verification.ok) {
      console.error('PayPal webhook rejected: ' + (verification.reason || 'not verified'));
      res.status(400).json({ error: 'Invalid webhook signature' });
      return;
    }
    var body = verification.body || {};

    var eventType = body.event_type || '';

    switch (eventType) {
      // Only a capture moves money. An approval moves none (the driver
      // captures an approved order as it verifies the approval), and the
      // capture's own event, which follows, is what pays the order.
      case 'PAYMENT.CAPTURE.COMPLETED': {
        var resource = body.resource || {};
        ${
          autoGenerateInvoice || hasOrderNotifications
            ? `var capture = await __checkPaypalCapture(resource);
        if (!capture.ok) {
          console.error('PayPal capture ' + (resource.id || '') + ' not applied: ' + capture.reason);
          break;
        }`
            : ''
        }
        ${
          autoGenerateInvoice
            ? `await handlePaypalInvoiceGeneration(resource, __baseUrl);`
            : `console.log('PayPal payment completed:', resource.id);`
        }
        ${
          hasOrderNotifications
            ? `try {
          await fetch(__baseUrl + '/api/ecommerce/order-notification', {
            method: 'POST',
            // The route emails the merchant only for the store's own server code.
            headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
            body: JSON.stringify({
              // The internal order id, so the route can load the order's own
              // lines and the rates they were charged at; the capture id is
              // only a fallback for a resource that carries no custom_id.
              orderId: __extractInternalOrderId(resource) || resource.id || '',
              customerEmail: (resource.payer && resource.payer.email_address) || '',
              customerName: resource.payer && resource.payer.name ? ((resource.payer.name.given_name || '') + ' ' + (resource.payer.name.surname || '')).trim() : '',
              totalAmount: resource.amount ? Number(resource.amount.value) || 0 : 0,
              paymentMethod: 'paypal',
            }),
          });
        } catch (notifErr) { console.error('PayPal order notification failed:', notifErr.message); }`
            : ''
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CREATED': {
        var subResource = body.resource || {};
        console.log('PayPal subscription created:', subResource.id);
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        var cancelledResource = body.resource || {};
        console.log('PayPal subscription cancelled:', cancelledResource.id);
        break;
      }

      default:
        console.log('Unhandled PayPal event type:', eventType);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    res.status(500).json({ error: error.message || 'Webhook processing failed' });
  }
};

function getRawBody(req) {
  return new Promise(function(resolve, reject) {
    if (req.body && Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() { resolve(Buffer.concat(chunks)); });
    req.on('error', function(err) { reject(err); });
  });
}

// PayPal's signature check needs the event exactly as it was sent.
module.exports.config = { api: { bodyParser: false } };

${
  autoGenerateInvoice || hasOrderNotifications
    ? `
// Pull the internal teleport_orders UUID out of the PayPal resource's
// custom_id field. Order creation embeds it as JSON
// {"orderId":"<uuid>","orderNumber":"ORD-N"} in payment-charge-user, so
// the webhook can correlate the PayPal capture back to the row that
// triggered it. Returns '' when custom_id is absent or malformed
// (Stripe-style flows that didn't go through this codepath, manual replays,
// etc.) — the caller should fall back to the PayPal resource id.
function __extractInternalOrderId(resource) {
  try {
    var raw = resource && resource.custom_id;
    if (!raw || typeof raw !== 'string') return '';
    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed.orderId === 'string' && parsed.orderId.length > 0) {
      return parsed.orderId;
    }
  } catch (e) {
    // custom_id wasn't JSON — that's fine, callers fall back.
  }
  return '';
}

// Whether a completed capture may pay the store order it names: the capture
// took the money, and the order exists, is neither cancelled nor settled
// already (a redelivered event pays and announces nothing twice), and is due
// exactly what was captured — its total less what a gift card covered — in
// its own currency. A capture that names no store order has nothing to check.
async function __checkPaypalCapture(resource) {
  var captureStatus = String(resource.status || 'COMPLETED').toUpperCase();
  if (captureStatus !== 'COMPLETED') {
    return { ok: false, reason: 'the capture is ' + captureStatus };
  }
  var internalOrderId = __extractInternalOrderId(resource);
  if (!internalOrderId) {
    return { ok: true };
  }
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL || '';
  if (!connStr) {
    return { ok: false, reason: 'no database connection to check order ' + internalOrderId + ' against' };
  }
  var pg;
  try {
    pg = require('pg');
  } catch (e) {
    return { ok: false, reason: 'the pg module is unavailable to check order ' + internalOrderId };
  }
  var client = new pg.Client({ connectionString: connStr, ssl: connStr.indexOf('sslmode=require') !== -1 ? { rejectUnauthorized: false } : undefined });
  var order = null;
  try {
    await client.connect();
    // gift_card_amount is read through the row's JSON: a store provisioned
    // before gift cards has no such column.
    var found = await client.query(
      "SELECT o.status, o.payment_status, o.currency, o.total_amount, COALESCE(to_jsonb(o) ->> 'gift_card_amount', '0') AS gift_card_amount FROM teleport_orders o WHERE o.id = $1",
      [internalOrderId]
    );
    order = found && found.rows && found.rows[0] ? found.rows[0] : null;
  } finally {
    try { await client.end(); } catch (_e) {}
  }
  if (!order) {
    return { ok: false, reason: 'the store has no order ' + internalOrderId };
  }
  if (String(order.status || '').toLowerCase() === 'cancelled') {
    return { ok: false, reason: 'order ' + internalOrderId + ' was cancelled' };
  }
  var paymentStatus = String(order.payment_status || '').toLowerCase();
  if (paymentStatus === 'paid' || paymentStatus === 'refunded' || paymentStatus === 'partially_refunded') {
    return { ok: false, reason: 'order ' + internalOrderId + ' is already ' + paymentStatus };
  }
  var amount = resource.amount || {};
  var capturedCurrency = String(amount.currency_code || '').toUpperCase();
  var orderCurrency = String(order.currency || '').toUpperCase();
  if (orderCurrency && capturedCurrency !== orderCurrency) {
    return { ok: false, reason: 'the capture is in ' + (capturedCurrency || 'no currency') + ' and order ' + internalOrderId + ' in ' + orderCurrency };
  }
  // Whole cents, so 12.30 - 4.10 compares as 820 and never 8.199999999999999.
  var due = Math.max(0, Math.round((Number(order.total_amount) - Number(order.gift_card_amount || 0)) * 100));
  var captured = Math.round(Number(amount.value) * 100);
  if (!isFinite(due) || captured !== due) {
    return {
      ok: false,
      reason: 'the capture took ' + String(amount.value) + ' ' + capturedCurrency + ' and order ' + internalOrderId + ' is due ' + (due / 100).toFixed(2),
    };
  }
  return { ok: true };
}
`
    : ''
}

${
  autoGenerateInvoice
    ? `
// Invoices a completed capture; the capture resource names no buyer, so the
// invoice route hydrates them from the order when the capture names one.
async function handlePaypalInvoiceGeneration(resource, baseUrl) {
  try {
    var customerEmail = '';
    var customerName = '';
    var currency = (resource.amount && resource.amount.currency_code) || 'USD';
    var total = Number(resource.amount && resource.amount.value) || 0;
    var items = [{
      name: 'PayPal Payment',
      quantity: 1,
      unitPrice: total,
      totalPrice: total,
      currency: currency,
    }];

    // baseUrl is passed in from the request handler so the self-fetch tracks
    // the actual port the dev server bound to. Falls back to env vars for
    // safety. Avoids the NEXTAUTH_URL=:3000 vs dev=:3001 mismatch.
    var resolvedBaseUrl = baseUrl || process.env.NEXTAUTH_URL || process.env.VERCEL_URL || 'http://localhost:3000';
    if (resolvedBaseUrl && !resolvedBaseUrl.startsWith('http')) resolvedBaseUrl = 'https://' + resolvedBaseUrl;

    // Prefer the internal teleport_orders UUID (embedded in custom_id by
    // payment-charge-user) so /api/invoices/generate can hydrate billing /
    // shipping / line items from the existing row. The PayPal capture id is
    // only useful as the linkage breadcrumb (paymentIntentId), not as the
    // order key — using it as orderId makes hydration miss and the resulting
    // invoice has no customer email and a placeholder line item.
    var internalOrderId = __extractInternalOrderId(resource);
    var paymentIntentId = (resource && resource.id) ? String(resource.id) : '';

    var invoicePayload = {
      customerName: customerName,
      customerEmail: customerEmail,
      items: items,
      currency: currency,
      paymentMethod: 'paypal',
      paymentProvider: 'paypal',
      orderId: internalOrderId || paymentIntentId,
      paymentIntentId: paymentIntentId,
      status: 'paid',
      paidAt: new Date().toISOString(),
    };

    // When we resolved the internal order id, drop the body.items array so
    // /api/invoices/generate hydrates line items from teleport_order_items
    // (real product names + quantities + per-item prices) instead of the
    // generic single-line-item fallback we'd otherwise build from the capture
    // resource. The amount comes back identical because the order row
    // already carries the same total — but the line breakdown matches what
    // the buyer actually saw at checkout.
    if (internalOrderId) {
      delete invoicePayload.items;
    }

    var response = await fetch(resolvedBaseUrl + '/api/invoices/generate', {
      method: 'POST',
      // The route issues invoices only for the store's own server code, which
      // presents the app secret.
      headers: { 'Content-Type': 'application/json', 'x-internal-data-secret': process.env.NEXTAUTH_SECRET || '' },
      body: JSON.stringify(invoicePayload),
    });

    if (!response.ok) {
      var errBody = await response.json().catch(function() { return {}; });
      console.error('Invoice generation failed:', errBody.error || response.statusText);
      return;
    }

    // Mirror the invoice onto the originating teleport_orders row so the
    // order-details page shows status=paid and a link to the PDF. Without
    // this the invoice is created but the order stays "Pending / Unpaid /
    // Invoice: Not available" because the order-details renderer reads
    // teleport_orders columns, not teleport_invoices. Skipped when there
    // was no internal order id (Stripe legacy flows etc. — they have their
    // own update path).
    if (internalOrderId) {
      try {
        var invoiceResp = await response.json().catch(function() { return {}; });
        await __linkInvoiceToOrder(internalOrderId, invoiceResp, paymentIntentId);
      } catch (linkErr) {
        console.error('PayPal webhook: failed to mirror invoice onto order ' + internalOrderId + ': ' + (linkErr && linkErr.message));
      }
    }
  } catch (err) {
    console.error('Failed to generate invoice from PayPal webhook:', err.message);
  }
}

// Stamp invoice + paid status onto teleport_orders. Direct pg client because
// /api/data/<dataSourceId>/update needs the workflow's data-source UUID,
// which the webhook doesn't have at codegen time. The connection string is
// the same one every generated DB route already reads.
async function __linkInvoiceToOrder(internalOrderId, invoiceResp, paymentIntentId) {
  var connStr = process.env.TELEPORT_DB_CONNECTION_STRING || process.env.DATABASE_URL || '';
  if (!connStr) {
    console.error('PayPal webhook: cannot mirror invoice — no DB connection string in env');
    return;
  }
  var pg;
  try {
    pg = require('pg');
  } catch (e) {
    console.error('PayPal webhook: pg module unavailable, skipping order mirror: ' + e.message);
    return;
  }
  var client = new pg.Client({ connectionString: connStr, ssl: connStr.indexOf('sslmode=require') !== -1 ? { rejectUnauthorized: false } : undefined });
  try {
    await client.connect();
    // Prefer the runtime-storage URL the invoice endpoint returned (storageUrl);
    // fall back to the in-DB-served pdf endpoint when storage is not configured.
    var pdfUrl = (invoiceResp && (invoiceResp.storageUrl || invoiceResp.pdfUrl)) || '';
    var invoiceId = (invoiceResp && invoiceResp.invoiceId) || null;
    var invoiceNumber = (invoiceResp && invoiceResp.invoiceNumber) || null;
    // teleport_orders schema: status (default 'pending'), payment_status
    // (default 'unpaid'), payment_intent_id, invoice_id (uuid), invoice_number,
    // invoice_pdf_url. No paid_at column — updated_at is the timestamp signal.
    //
    // status / payment_status are semantically different fields. status is
    // the ORDER lifecycle (pending → confirmed → shipped → delivered);
    // payment_status is the MONEY state (unpaid → paid → refunded). A paid
    // online order should set status='confirmed' (not 'paid'), matching the
    // Stripe + COD paths so the order-details page renders a consistent
    // "Status: Confirmed / Payment: Paid". A cancelled order stays
    // cancelled, whatever pays for it late.
    await client.query(
      "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), invoice_id = COALESCE($4, invoice_id), invoice_number = COALESCE($5, invoice_number), invoice_pdf_url = COALESCE(NULLIF($6, ''), invoice_pdf_url), updated_at = NOW() WHERE id = $7 AND status IS DISTINCT FROM 'cancelled'",
      ['confirmed', 'paid', paymentIntentId || '', invoiceId, invoiceNumber, pdfUrl, internalOrderId]
    );
    console.info('[paypal webhook] order ' + internalOrderId + ' marked confirmed/paid — invoice=' + (invoiceNumber || '(none)') + ' pdf=' + (pdfUrl || '(none)'));
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}
`
    : ''
}
`
}

export interface GenerateWebhookFilesOptions {
  // Providers whose webhook handler is already owned by a workflow-driven
  // route (event-webhook-received + webhookConfig). The legacy hard-coded
  // emission is skipped for those providers to avoid two concurrent
  // implementations of the same webhook in the generated project.
  skipProviders?: ReadonlySet<string>
}

export const generateWebhookFiles = (
  structure: ProjectPluginStructure,
  invoiceSettings: UIDLInvoiceSettings | undefined,
  options: GenerateWebhookFilesOptions = {}
): void => {
  const { uidl, files } = structure
  const env = uidl.globals?.env || {}
  const ecommerceSettings = uidl.ecommerceSettings
  const ecommerceProviders = ecommerceSettings?.paymentProviders || []
  const providerTypes = ecommerceProviders.map((p) => p.type)
  const skipProviders = options.skipProviders || new Set<string>()

  const emitStripe =
    (Object.keys(env).some(
      (k) => k.includes('STRIPE_SECRET_KEY') || k.includes('STRIPE_WEBHOOK_SECRET')
    ) ||
      providerTypes.includes('stripe')) &&
    !skipProviders.has('stripe')

  const emitPaypal =
    (Object.keys(env).some(
      (k) => k.includes('PAYPAL_CLIENT_ID') || k.includes('PAYPAL_CLIENT_SECRET')
    ) ||
      providerTypes.includes('paypal')) &&
    !skipProviders.has('paypal')

  if (!emitStripe && !emitPaypal) {
    return
  }
  // Both routes verify through the store's drivers. The module is written
  // once, by whichever emitter comes first, so it carries every provider the
  // store uses — not only the two these routes need.
  const storeDriverIds = resolveStorePaymentDriverIds(uidl, [])
  ensurePaymentDriversModule(
    structure,
    storeDriverIds.length > 0 ? storeDriverIds : DEFAULT_PAYMENT_DRIVER_IDS
  )

  if (emitStripe) {
    files.set('webhook-stripe', {
      path: ['pages', 'api', 'webhooks'],
      files: [
        {
          name: 'stripe',
          fileType: FileType.JS,
          content: generateStripeWebhookCode(invoiceSettings, ecommerceSettings),
        },
      ],
    })
  }

  if (emitPaypal) {
    files.set('webhook-paypal', {
      path: ['pages', 'api', 'webhooks'],
      files: [
        {
          name: 'paypal',
          fileType: FileType.JS,
          content: generatePaypalWebhookCode(invoiceSettings, ecommerceSettings),
        },
      ],
    })
  }
}
