/**
 * The gate a generated cron route runs before anything else. Without it the
 * route runs its workflow — sends the emails, writes the rows — for whoever
 * calls the URL.
 *
 * crons-worker signs every scheduled request: `x-teleport-cron-timestamp`
 * (unix seconds) and `x-teleport-cron-signature: v1=<hex>`, an HMAC-SHA256
 * keyed with the project's `TELEPORT_CRON_SECRET` (filled in by the deploy)
 * over `v1:<timestamp>:<projectId>:<cronId>:<executionId>:<pathname>`, from
 * the request's `x-teleport-project-id` / `x-teleport-cron-id` /
 * `x-teleport-cron-execution-id` headers and its own URL path. The route
 * accepts, in order:
 *   (a) that signature under `TELEPORT_CRON_SECRET`, or under
 *       `TELEPORT_CRON_SECRET_PREVIOUS` while a key is being rotated, with a
 *       timestamp within 300 s of the route's clock;
 *   (b) Vercel Cron's `Authorization: Bearer <CRON_SECRET>`, when `CRON_SECRET`
 *       is set;
 *   (c) any request, only when `TELEPORT_CRON_ALLOW_UNSIGNED` is `'true'` — a
 *       local run with no crons-worker in front of it.
 * An unset key never verifies: an HMAC keyed with an empty string is one
 * anybody can compute.
 */
export const generateCronRequestVerificationCode = (): string => `
var __CRON_SIGNATURE_TOLERANCE_SECONDS = 300;

function __cronHeader(req, name) {
  var value = req.headers && req.headers[name];
  return typeof value === 'string' ? value : '';
}

function __cronSecretsEqual(expected, received) {
  var crypto = require('crypto');
  var a = Buffer.from(expected);
  var b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function __cronSignatureMatches(secret, signed, signature) {
  if (!secret) return false;
  var crypto = require('crypto');
  var expected = 'v1=' + crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return __cronSecretsEqual(expected, signature);
}

function __verifyCronSignature(req) {
  var signature = __cronHeader(req, 'x-teleport-cron-signature');
  var timestamp = __cronHeader(req, 'x-teleport-cron-timestamp');
  var cronId = __cronHeader(req, 'x-teleport-cron-id');
  var projectId = __cronHeader(req, 'x-teleport-project-id');
  var executionId = __cronHeader(req, 'x-teleport-cron-execution-id');
  if (!signature || !/^\\d+$/.test(timestamp) || !cronId || !projectId || !executionId) {
    return false;
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > __CRON_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  var path;
  try {
    path = new URL(req.url || '/', 'http://localhost').pathname;
  } catch (_e) {
    return false;
  }
  var signed = ['v1', timestamp, projectId, cronId, executionId, path].join(':');
  return (
    __cronSignatureMatches(process.env.TELEPORT_CRON_SECRET, signed, signature) ||
    __cronSignatureMatches(process.env.TELEPORT_CRON_SECRET_PREVIOUS, signed, signature)
  );
}

function verifyCronRequest(req) {
  if (__verifyCronSignature(req)) {
    return true;
  }
  var vercelCronSecret = process.env.CRON_SECRET;
  if (vercelCronSecret && __cronSecretsEqual('Bearer ' + vercelCronSecret, __cronHeader(req, 'authorization'))) {
    return true;
  }
  return process.env.TELEPORT_CRON_ALLOW_UNSIGNED === 'true';
}`
