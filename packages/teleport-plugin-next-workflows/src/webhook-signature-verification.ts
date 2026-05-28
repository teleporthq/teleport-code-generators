export const generateGetRawBodyCode = (): string => {
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

export const generatePaypalSignatureVerificationCode = (): string => {
  return `
async function verifyPaypalSignature(req, rawBody, webhookConfig) {
  try {
    var clientId = process.env.PAYPAL_CLIENT_ID || '';
    var clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
    if (!clientId || !clientSecret) return false;

    var isLive = !clientId.startsWith('sb-');
    var baseUrl = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

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

    var webhookId = process.env[webhookConfig.signatureSecret] || '';

    var verifyResponse = await fetch(baseUrl + '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + authData.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: req.headers['paypal-auth-algo'] || '',
        cert_url: req.headers['paypal-cert-url'] || '',
        transmission_id: req.headers['paypal-transmission-id'] || '',
        transmission_sig: req.headers['paypal-transmission-sig'] || '',
        transmission_time: req.headers['paypal-transmission-time'] || '',
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody.toString('utf-8')),
      }),
    });
    var verifyData = await verifyResponse.json();
    return verifyData.verification_status === 'SUCCESS';
  } catch (_e) {
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

export const generateSignatureDispatcherCode = (): string => {
  return `
async function verifyWebhookSignature(req, rawBody, webhookConfig) {
  var algorithm = webhookConfig.signatureAlgorithm || 'hmac-sha256';
  var sigHeader = webhookConfig.signatureHeader || '';
  var sigSecret = webhookConfig.signatureSecret || '';
  var secret = process.env[sigSecret] || '';

  if (algorithm === 'stripe-v1') {
    var sig = req.headers[sigHeader || 'stripe-signature'] || '';
    return verifyStripeSignature(rawBody, sig, secret);
  }

  if (algorithm === 'paypal-v1') {
    return await verifyPaypalSignature(req, rawBody, webhookConfig);
  }

  if (algorithm === 'hmac-sha256') {
    var hmacSig = req.headers[(sigHeader || '').toLowerCase()] || '';
    return verifyHmacSignature(rawBody, hmacSig, secret);
  }

  if (algorithm === 'hmac-sha1') {
    var hmacSha1Sig = req.headers[(sigHeader || '').toLowerCase()] || '';
    return verifyHmacSha1Signature(rawBody, hmacSha1Sig, secret);
  }

  return true;
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
