import {
  ProjectPluginStructure,
  FileType,
  UIDLInvoiceSettings,
  UIDLEcommerceSettings,
} from '@teleporthq/teleport-types'

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

// Mirrors the lookup used by /api/ecommerce/paypal/capture and the PayPal
// webhook so the Stripe handler resolves credentials from either STRIPE_*
// (legacy) or CONFIGURATION_STRIPE_* (current generator output) without
// forcing the user to duplicate env vars.
function __resolveStripeSecret(candidates, prefixScan) {
  for (var i = 0; i < candidates.length; i++) {
    var v = process.env[candidates[i]];
    if (v && String(v).length > 0) return String(v);
  }
  if (prefixScan) {
    var keys = Object.keys(process.env);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(prefixScan) === 0) {
        var v2 = process.env[keys[j]];
        if (v2 && String(v2).length > 0) return String(v2);
      }
    }
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Live request origin tracks the actual port the dev server bound to —
  // NEXTAUTH_URL is often set to :3000 while dev runs on :3001, which
  // breaks every self-fetch (invoice generation, order notification).
  var __proto = req.headers['x-forwarded-proto'] ||
    (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
  var __reqBaseUrl = req.headers.host ? (__proto + '://' + req.headers.host) : '';
  var __envBaseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || '';
  if (__envBaseUrl && !__envBaseUrl.startsWith('http')) __envBaseUrl = 'https://' + __envBaseUrl;
  var __baseUrl = __reqBaseUrl || __envBaseUrl || 'http://localhost:3000';

  var stripeSecretKey = __resolveStripeSecret(['STRIPE_SECRET_KEY', 'CONFIGURATION_STRIPE_SECRET_KEY', 'STRIPE_TEST_KEY'], 'CONFIGURATION_STRIPE_SECRET_KEY');
  var webhookSecret = __resolveStripeSecret(['STRIPE_WEBHOOK_SECRET', 'CONFIGURATION_STRIPE_WEBHOOK_SECRET'], 'CONFIGURATION_STRIPE_WEBHOOK_SECRET');

  if (!stripeSecretKey) {
    res.status(500).json({ error: 'Stripe secret key not configured' });
    return;
  }

  try {
    var rawBody = await getRawBody(req);
    var event;

    if (webhookSecret) {
      var sig = req.headers['stripe-signature'];
      if (!sig) {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
      }
      event = verifyStripeSignature(rawBody, sig, webhookSecret);
      if (!event) {
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }
    } else {
      event = JSON.parse(rawBody.toString('utf-8'));
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        var session = event.data.object;
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
            ? `await handleStripeInvoicePayment(stripeInvoice, __baseUrl);`
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

function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    var crypto = require('crypto');
    var parts = sigHeader.split(',');
    var timestamp = '';
    var signatures = [];

    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].trim().split('=');
      if (kv[0] === 't') timestamp = kv[1];
      if (kv[0] === 'v1') signatures.push(kv[1]);
    }

    if (!timestamp || signatures.length === 0) return null;

    var signedPayload = timestamp + '.' + payload.toString('utf-8');
    var expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    var valid = false;
    for (var j = 0; j < signatures.length; j++) {
      if (crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signatures[j]))) {
        valid = true;
        break;
      }
    }

    if (!valid) return null;

    var tolerance = 300;
    var now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > tolerance) return null;

    return JSON.parse(payload.toString('utf-8'));
  } catch (e) {
    return null;
  }
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
      await client.query(
        "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), updated_at = NOW() WHERE id = $4",
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: orderId || session.id,
        customerEmail: session.customer_email || (session.customer_details && session.customer_details.email) || '',
        customerName: (session.customer_details && session.customer_details.name) || '',
        totalAmount: (session.amount_total || 0) / 100,
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
    // teleport_orders UUID in metadata.orderId. Falling back to '' means we
    // skip hydration cleanly when called via payment_intent.succeeded events
    // (which carry no metadata).
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
            unitPrice: (li.amount_total || 0) / (li.quantity || 1) / 100,
            totalPrice: (li.amount_total || 0) / 100,
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
                unitPrice: (li.amount_total || 0) / (li.quantity || 1) / 100,
                totalPrice: (li.amount_total || 0) / 100,
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
        unitPrice: (paymentObj.amount || 0) / 100,
        totalPrice: (paymentObj.amount || 0) / 100,
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
      headers: { 'Content-Type': 'application/json' },
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
    // lifecycle (confirmed = order accepted), payment_status tracks money.
    await client.query(
      "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), invoice_id = COALESCE($4, invoice_id), invoice_number = COALESCE($5, invoice_number), invoice_pdf_url = COALESCE(NULLIF($6, ''), invoice_pdf_url), updated_at = NOW() WHERE id = $7",
      ['confirmed', 'paid', paymentIntentId || '', invoiceId, invoiceNumber, pdfUrl, internalOrderId]
    );
    console.info('[stripe webhook] order ' + internalOrderId + ' marked confirmed/paid — invoice=' + (invoiceNumber || '(none)') + ' pdf=' + (pdfUrl || '(none)'));
  } finally {
    try { await client.end(); } catch (_e) {}
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
          unitPrice: (li.amount || 0) / 100,
          totalPrice: (li.amount || 0) / 100,
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
      headers: { 'Content-Type': 'application/json' },
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

// Mirrors the lookup used by /api/ecommerce/paypal/capture so the webhook
// resolves credentials from either PAYPAL_* (legacy) or CONFIGURATION_PAYPAL_*
// (current generator output) without forcing the user to duplicate env vars.
function __resolvePaypalSecret(candidates, prefixScan) {
  for (var i = 0; i < candidates.length; i++) {
    var v = process.env[candidates[i]];
    if (v && String(v).length > 0) return String(v);
  }
  if (prefixScan) {
    var keys = Object.keys(process.env);
    for (var j = 0; j < keys.length; j++) {
      if (keys[j].indexOf(prefixScan) === 0) {
        var v2 = process.env[keys[j]];
        if (v2 && String(v2).length > 0) return String(v2);
      }
    }
  }
  return '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var clientId = __resolvePaypalSecret(['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'], 'CONFIGURATION_PAYPAL_CLIENT_ID');
  var clientSecret = __resolvePaypalSecret(['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'], 'CONFIGURATION_PAYPAL_CLIENT_SECRET');
  var webhookId = __resolvePaypalSecret(['PAYPAL_WEBHOOK_ID', 'CONFIGURATION_PAYPAL_WEBHOOK_ID'], 'CONFIGURATION_PAYPAL_WEBHOOK_ID');

  if (!clientId || !clientSecret) {
    res.status(500).json({ error: 'PayPal credentials not configured' });
    return;
  }

  // Live request origin — preferred over NEXTAUTH_URL because it tracks the
  // actual port the dev server is bound to. Falls back to NEXTAUTH_URL /
  // VERCEL_URL when the request lacks a host header (shouldn't happen under
  // Next.js, but stays defensive). Same pattern as /api/invoices/generate.
  var __proto = req.headers['x-forwarded-proto'] ||
    (req.headers.host && (req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.0.0.1')) ? 'http' : 'https');
  var __reqBaseUrl = req.headers.host ? (__proto + '://' + req.headers.host) : '';
  var __envBaseUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL || '';
  if (__envBaseUrl && !__envBaseUrl.startsWith('http')) __envBaseUrl = 'https://' + __envBaseUrl;
  var __baseUrl = __reqBaseUrl || __envBaseUrl || 'http://localhost:3000';

  try {
    var body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    if (webhookId) {
      var verified = await verifyPaypalWebhook(req.headers, body, webhookId, clientId, clientSecret);
      if (!verified) {
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    var eventType = body.event_type || '';

    switch (eventType) {
      case 'CHECKOUT.ORDER.APPROVED':
      case 'PAYMENT.CAPTURE.COMPLETED': {
        var resource = body.resource || {};
        ${
          autoGenerateInvoice
            ? `await handlePaypalInvoiceGeneration(resource, eventType, clientId, clientSecret, __baseUrl);`
            : `console.log('PayPal payment completed:', resource.id);`
        }
        ${
          hasOrderNotifications
            ? `try {
          await fetch(__baseUrl + '/api/ecommerce/order-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: resource.id || '',
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

async function verifyPaypalWebhook(headers, body, webhookId, clientId, clientSecret) {
  try {
    // Detect environment from the cert URL PayPal embedded in the request,
    // not from the client id prefix. Sandbox client ids do NOT consistently
    // start with "sb-" — that heuristic was wrong and routed sandbox webhook
    // verifications to the live API, which then rejected the sandbox cert
    // with verification_status=FAILURE. The cert URL itself authoritatively
    // says "sandbox" vs production.
    var certUrl = String(headers['paypal-cert-url'] || '');
    var isSandbox = certUrl.indexOf('sandbox.paypal.com') !== -1 ||
                    certUrl.indexOf('api.sandbox.paypal.com') !== -1;
    var baseUrl = isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

    var authResponse = await fetch(baseUrl + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    var authData = await authResponse.json();
    if (!authData.access_token) return false;

    var verifyResponse = await fetch(baseUrl + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authData.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'] || '',
        cert_url: headers['paypal-cert-url'] || '',
        transmission_id: headers['paypal-transmission-id'] || '',
        transmission_sig: headers['paypal-transmission-sig'] || '',
        transmission_time: headers['paypal-transmission-time'] || '',
        webhook_id: webhookId,
        webhook_event: body,
      }),
    });
    var verifyData = await verifyResponse.json();
    var ok = verifyData.verification_status === 'SUCCESS';
    if (!ok) {
      console.error('PayPal webhook verification rejected by ' + baseUrl + ' — verification_status=' + (verifyData.verification_status || '(missing)') + ', name=' + (verifyData.name || '(none)') + ', message=' + (verifyData.message || '(none)'));
    }
    return ok;
  } catch (e) {
    console.error('PayPal webhook verification failed:', e.message);
    return false;
  }
}

${
  autoGenerateInvoice
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

async function handlePaypalInvoiceGeneration(resource, eventType, clientId, clientSecret, baseUrl) {
  try {
    var customerEmail = '';
    var customerName = '';
    var items = [];
    var currency = 'USD';
    var total = 0;

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      currency = (resource.amount && resource.amount.currency_code) || 'USD';
      total = Number(resource.amount && resource.amount.value) || 0;
      items = [{
        name: 'PayPal Payment',
        quantity: 1,
        unitPrice: total,
        totalPrice: total,
        currency: currency,
      }];
    } else if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      var purchaseUnit = (resource.purchase_units && resource.purchase_units[0]) || {};
      currency = (purchaseUnit.amount && purchaseUnit.amount.currency_code) || 'USD';
      total = Number(purchaseUnit.amount && purchaseUnit.amount.value) || 0;

      if (purchaseUnit.items) {
        items = purchaseUnit.items.map(function(item) {
          return {
            name: item.name || '',
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unit_amount && item.unit_amount.value) || 0,
            totalPrice: (Number(item.quantity) || 1) * (Number(item.unit_amount && item.unit_amount.value) || 0),
            currency: currency,
          };
        });
      } else {
        items = [{
          name: 'PayPal Order',
          quantity: 1,
          unitPrice: total,
          totalPrice: total,
          currency: currency,
        }];
      }

      if (purchaseUnit.shipping && purchaseUnit.shipping.name) {
        customerName = purchaseUnit.shipping.name.full_name || '';
      }
      if (resource.payer) {
        customerEmail = resource.payer.email_address || '';
        if (!customerName && resource.payer.name) {
          customerName = (resource.payer.name.given_name || '') + ' ' + (resource.payer.name.surname || '');
          customerName = customerName.trim();
        }
      }
    }

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
      headers: { 'Content-Type': 'application/json' },
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
    // "Status: Confirmed / Payment: Paid".
    await client.query(
      "UPDATE teleport_orders SET status = $1, payment_status = $2, payment_intent_id = COALESCE(NULLIF($3, ''), payment_intent_id), invoice_id = COALESCE($4, invoice_id), invoice_number = COALESCE($5, invoice_number), invoice_pdf_url = COALESCE(NULLIF($6, ''), invoice_pdf_url), updated_at = NOW() WHERE id = $7",
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
  skipProviders?: Set<'stripe' | 'paypal'>
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
  const skipProviders = options.skipProviders || new Set<'stripe' | 'paypal'>()

  const hasStripe =
    Object.keys(env).some(
      (k) => k.includes('STRIPE_SECRET_KEY') || k.includes('STRIPE_WEBHOOK_SECRET')
    ) || providerTypes.includes('stripe')

  const hasPaypal =
    Object.keys(env).some(
      (k) => k.includes('PAYPAL_CLIENT_ID') || k.includes('PAYPAL_CLIENT_SECRET')
    ) || providerTypes.includes('paypal')

  if (hasStripe && !skipProviders.has('stripe')) {
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

  if (hasPaypal && !skipProviders.has('paypal')) {
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
