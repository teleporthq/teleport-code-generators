/** The raw request body, and the object it stands for (JSON or form-encoded). */
export const generateWebhookBodyCode = (): string => {
  return `
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

// Some providers (Mollie, CoinGate) post \`application/x-www-form-urlencoded\`.
function parseWebhookBody(req, rawBody) {
  var text = rawBody.toString('utf-8');
  var contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.indexOf('application/x-www-form-urlencoded') === -1) {
    try { return JSON.parse(text); } catch (_e) { return {}; }
  }
  var result = {};
  var pairs = text ? text.split('&') : [];
  for (var i = 0; i < pairs.length; i++) {
    if (!pairs[i]) continue;
    var eq = pairs[i].indexOf('=');
    var key = eq >= 0 ? pairs[i].slice(0, eq) : pairs[i];
    var value = eq >= 0 ? pairs[i].slice(eq + 1) : '';
    try {
      result[decodeURIComponent(key.replace(/\\+/g, ' '))] = decodeURIComponent(value.replace(/\\+/g, ' '));
    } catch (_e) {
      result[key] = value;
    }
  }
  return result;
}`
}

export const generateStripeSignatureVerificationCode = (): string => {
  return `
function verifyStripeSignature(rawBody, sigHeader, secret) {
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

    if (!timestamp || signatures.length === 0) return false;

    var signedPayload = timestamp + '.' + rawBody.toString('utf-8');
    var expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    var valid = false;
    for (var j = 0; j < signatures.length; j++) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signatures[j]))) {
          valid = true;
          break;
        }
      } catch (_e) {}
    }

    if (!valid) return false;

    var tolerance = 300;
    var now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(timestamp)) > tolerance) return false;

    return true;
  } catch (_e) {
    return false;
  }
}`
}

// The credentials are read through the same fallback chain the payment nodes
// use: the canonical name the deploy writes, then the CONFIGURATION_* name the
// provider panel stores locally (a standalone run has only that one). The
// environment to verify against is the one that signed the event — PayPal
// names it in the cert URL. Both environments issue client ids starting with
// "A", so the id says nothing; the earlier "sb-" prefix check sent every
// sandbox verification to the live API, which rejected it.
export const generatePaypalSignatureVerificationCode = (): string => {
  return `
function resolvePaypalEnv(candidates, prefix) {
  var env = process.env;
  for (var i = 0; i < candidates.length; i++) {
    var value = candidates[i] ? env[candidates[i]] : '';
    if (value && String(value).length > 0) return String(value);
  }
  var keys = Object.keys(env);
  for (var k = 0; k < keys.length; k++) {
    if (keys[k].indexOf(prefix) === 0 && env[keys[k]] && String(env[keys[k]]).length > 0) {
      return String(env[keys[k]]);
    }
  }
  return '';
}

async function verifyPaypalSignature(req, rawBody, webhookConfig) {
  try {
    var clientId = resolvePaypalEnv(['PAYPAL_CLIENT_ID', 'CONFIGURATION_PAYPAL_CLIENT_ID'], 'CONFIGURATION_PAYPAL_CLIENT_ID');
    var clientSecret = resolvePaypalEnv(['PAYPAL_CLIENT_SECRET', 'CONFIGURATION_PAYPAL_CLIENT_SECRET'], 'CONFIGURATION_PAYPAL_CLIENT_SECRET');
    var webhookId = resolvePaypalEnv([webhookConfig.signatureSecret || '', 'PAYPAL_WEBHOOK_ID', 'CONFIGURATION_PAYPAL_WEBHOOK_ID'], 'CONFIGURATION_PAYPAL_WEBHOOK_ID');
    if (!clientId || !clientSecret) {
      console.error('PayPal webhook rejected: PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are not configured');
      return false;
    }
    if (!webhookId) {
      console.error('PayPal webhook rejected: the webhook id (PAYPAL_WEBHOOK_ID) is not configured');
      return false;
    }

    var certUrl = String(req.headers['paypal-cert-url'] || '');
    var isSandbox = certUrl.indexOf('sandbox.paypal.com') !== -1;
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
    if (!authData.access_token) {
      console.error('PayPal webhook rejected: authentication against ' + baseUrl + ' failed — ' + (authData.error_description || authData.error || 'no token'));
      return false;
    }

    // PayPal checks the signature over the event EXACTLY as it was sent, so
    // the raw text is spliced in by position before the closing brace: parsed
    // and serialised again, a number or a character escape can come back
    // spelled differently and the signature no longer matches.
    var fields = JSON.stringify({
      auth_algo: req.headers['paypal-auth-algo'] || '',
      cert_url: req.headers['paypal-cert-url'] || '',
      transmission_id: req.headers['paypal-transmission-id'] || '',
      transmission_sig: req.headers['paypal-transmission-sig'] || '',
      transmission_time: req.headers['paypal-transmission-time'] || '',
      webhook_id: webhookId,
    });
    var verifyResponse = await fetch(baseUrl + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authData.access_token,
        'Content-Type': 'application/json',
      },
      body: fields.slice(0, -1) + ',"webhook_event":' + rawBody.toString('utf-8') + '}',
    });
    var verifyData = await verifyResponse.json();
    var ok = verifyData.verification_status === 'SUCCESS';
    if (!ok) {
      console.error('PayPal webhook rejected by ' + baseUrl + ': verification_status=' + (verifyData.verification_status || '(missing)') + ', name=' + (verifyData.name || '(none)') + ', message=' + (verifyData.message || '(none)'));
    }
    return ok;
  } catch (e) {
    console.error('PayPal webhook verification failed:', e && e.message);
    return false;
  }
}`
}

export const generateHmacSignatureVerificationCode = (
  algorithm: 'sha256' | 'sha1' = 'sha256'
): string => {
  const prefix = algorithm === 'sha1' ? 'sha1' : 'sha256'
  return `
function verifyHmac${
    algorithm === 'sha1' ? 'Sha1' : ''
  }Signature(rawBody, signatureHeader, secret) {
  try {
    var crypto = require('crypto');
    var expectedSig = crypto
      .createHmac('${prefix}', secret)
      .update(rawBody)
      .digest('hex');

    var cleanSig = signatureHeader.replace(/^${prefix}=/, '');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(cleanSig, 'hex'),
        Buffer.from(expectedSig, 'hex')
      );
    } catch (_e) {
      return cleanSig === expectedSig;
    }
  } catch (_e) {
    return false;
  }
}`
}

// Fails CLOSED: a scheme it does not know, or a shared-secret scheme whose
// secret is not configured, is a refusal — an HMAC keyed with an empty string
// is one anybody can compute. `custom` is the author verifying the request in
// the workflow itself (headers and body are on the trigger context); payment
// webhooks never use it (see `generatePaymentWebhookVerificationCode`).
export const generateSignatureDispatcherCode = (): string => {
  return `
async function verifyWebhookSignature(req, rawBody, webhookConfig) {
  var algorithm = webhookConfig.signatureAlgorithm || 'hmac-sha256';
  var sigHeader = webhookConfig.signatureHeader || '';
  var sigSecret = webhookConfig.signatureSecret || '';
  var secret = sigSecret ? process.env[sigSecret] || '' : '';

  if (algorithm === 'custom') {
    return true;
  }

  if (algorithm === 'paypal-v1') {
    return await verifyPaypalSignature(req, rawBody, webhookConfig);
  }

  if (!secret) {
    console.error('Webhook rejected: the signing secret (' + (sigSecret || 'none named') + ') is not configured.');
    return false;
  }

  if (algorithm === 'stripe-v1') {
    var sig = req.headers[sigHeader || 'stripe-signature'] || '';
    return verifyStripeSignature(rawBody, sig, secret);
  }

  if (algorithm === 'hmac-sha256') {
    var hmacSig = req.headers[(sigHeader || '').toLowerCase()] || '';
    return verifyHmacSignature(rawBody, hmacSig, secret);
  }

  if (algorithm === 'hmac-sha1') {
    var hmacSha1Sig = req.headers[(sigHeader || '').toLowerCase()] || '';
    return verifyHmacSha1Signature(rawBody, hmacSha1Sig, secret);
  }

  console.error('Webhook rejected: unknown signature algorithm "' + algorithm + '".');
  return false;
}`
}

/**
 * A PAYMENT webhook is verified by the store's driver for its provider (see
 * `src/payments`): a signature, or the event read back from the provider
 * with the store's own key. The answer carries the AUTHORITATIVE body — the
 * copy the provider gave back, where there is one — and whether the provider
 * should try again (an outage) rather than drop the delivery.
 *
 * The store's own server may also ask the route to SETTLE a payment it just
 * confirmed with the provider (a PayPal buyer's return): a body naming
 * `teleportReconcile`, accepted only with the runtime's internal-call token.
 * The driver reads the payment from the provider and answers the event the
 * provider sends for it; nothing but the provider's id is taken from the
 * request, and any other caller is refused outright.
 */
export const generatePaymentWebhookVerificationCode = (): string => {
  return `
async function settlePaymentFromProvider(req, body, provider, driver) {
  var internal = typeof utils !== 'undefined' && utils && typeof utils.isInternalCall === 'function' && utils.isInternalCall(req);
  if (!internal || typeof driver.reconcile !== 'function') {
    console.error('Payment webhook rejected (' + provider + '): a settlement request that did not come from this store.');
    return { ok: false, retry: false };
  }
  try {
    var settled = await driver.reconcile(body.teleportReconcile);
    if (!settled || !settled.ok) {
      console.error('Payment settlement skipped (' + provider + '): ' + ((settled && settled.reason) || 'not settled'));
      return { ok: false, retry: !!(settled && settled.retry) };
    }
    return { ok: true, body: settled.body };
  } catch (e) {
    console.error('Payment settlement failed (' + provider + '):', e && e.message);
    return { ok: false, retry: true };
  }
}

async function verifyPaymentWebhook(req, rawBody, body, webhookConfig) {
  var provider = webhookConfig.paymentProvider;
  var driver = typeof __paymentDrivers !== 'undefined' && __paymentDrivers ? __paymentDrivers.get(provider) : null;
  if (!driver || typeof driver.verifyWebhook !== 'function') {
    console.error('Payment webhook rejected: this store has no ' + provider + ' payment driver.');
    return { ok: false, retry: false };
  }
  if (body && typeof body === 'object' && body.teleportReconcile) {
    return settlePaymentFromProvider(req, body, provider, driver);
  }
  var host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  var proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() ||
    (host.indexOf('localhost') === 0 || host.indexOf('127.0.0.1') === 0 ? 'http' : 'https');
  var sigSecret = webhookConfig.signatureSecret || '';
  var sigSecretValue = sigSecret ? String(process.env[sigSecret] || '') : '';
  try {
    var result = await driver.verifyWebhook({
      headers: req.headers || {},
      rawBody: rawBody,
      body: body,
      query: req.query || {},
      // The whole URL the provider posted to, query string included: Square
      // signs the notification URL exactly as it was registered.
      url: host ? proto + '://' + host + String(req.url || '') : '',
      // A placeholder the deploy never resolved (a local run) is no secret:
      // the driver then reads the saved credential itself.
      secret: sigSecretValue.indexOf('teleporthq.secrets.') === 0 ? '' : sigSecretValue,
    });
    if (!result || !result.ok) {
      console.error('Payment webhook rejected (' + provider + '): ' + ((result && result.reason) || 'not verified'));
      return { ok: false, retry: !!(result && result.retry) };
    }
    return { ok: true, body: result.body || body };
  } catch (e) {
    console.error('Payment webhook verification failed (' + provider + '):', e && e.message);
    return { ok: false, retry: true };
  }
}`
}

export const generateAllSignatureVerificationCode = (): string => {
  return [
    generateStripeSignatureVerificationCode(),
    generatePaypalSignatureVerificationCode(),
    generateHmacSignatureVerificationCode('sha256'),
    generateHmacSignatureVerificationCode('sha1'),
    generateSignatureDispatcherCode(),
  ].join('\n')
}
