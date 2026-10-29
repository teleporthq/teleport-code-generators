/**
 * `utils/newsletter/newsletter.js`: the one place the generated app changes a
 * person's newsletter state. The public sign-up route, the `newsletter-subscribe`
 * node, the sign-up route's consent box and the confirm / unsubscribe routes all
 * go through it, so the policy is written once:
 *
 * - nobody is subscribed without their own action: a submit (single opt-in),
 *   or the emailed confirmation link (double opt-in);
 * - a form never undoes an opt-out: anyone can type anyone's address, so an
 *   unsubscribed address is only ever sent a confirmation link;
 * - every sign-up answers the same (`{ ok: true, pending }`, `pending` decided
 *   by the settings alone), so the answer never tells whether an address is
 *   known;
 * - the links are stateless HMAC tokens keyed by the app secret
 *   (`newsletterTokenSpec`), which the services worker reproduces for the
 *   unsubscribe links of the newsletters it sends.
 *
 * CommonJS, server-only. The TeleportHQ database (`TELEPORT_DB_*`), through the
 * same Postgres client the account routes open.
 */
import type { UIDLNewsletterSettings } from '@teleporthq/teleport-types'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  generateEmailLocaleRequire,
  generateFillTemplateFn,
  generateProviderSendFunction,
} from '../transactional-email-code'
import { generateLazyPgClientCode } from '../pg-client-code'
import { securityRuntimeSpecifier } from '../security-runtime/security-runtime-code'
import { TRUSTED_ORIGIN_CODE } from '../password-reset-route-generator'
import { AUTOMATIONS_PATH } from '../automations/automations-scope'
import {
  DEFAULT_NEWSLETTER_CONFIRM_PATH,
  DEFAULT_NEWSLETTER_UNSUBSCRIBE_PATH,
  NEWSLETTER_ADDRESS_LIMIT,
  NEWSLETTER_MIN_RESPONSE_MS,
  NEWSLETTER_OPTED_OUT_CONFIRMATIONS_PER_DAY,
  NEWSLETTER_SOURCES,
  NEWSLETTER_UNSUBSCRIBE_URL,
  NEWSLETTER_USERS_TABLE,
  PUBLIC_ROUTE_SIGN_UP_POINTS,
  VISITOR_SIGN_UP_POINTS,
} from './newsletter-scope'

/** From `utils/newsletter/` to the project root. */
const RELATIVE_PREFIX = '../..'

/**
 * The confirmation and unsubscribe links' token, exactly, so the services
 * worker (the unsubscribe links in the newsletters it sends, R-N7) mints the
 * same bytes as the site:
 *
 *   key     = HMAC-SHA256(key: NEXTAUTH_SECRET (UTF-8), message: 'teleport-newsletter:v1')  → 32 bytes
 *   payload = UTF-8 of `${email}|${purpose}|${issuedAt}`
 *             email: trimmed, lower-cased; purpose: 'confirm' | 'unsubscribe';
 *             issuedAt: whole seconds since the Unix epoch, in decimal
 *   token   = base64url(payload) + '.' + base64url(HMAC-SHA256(key, payload))
 *             base64url = RFC 4648 §5, no '=' padding
 *
 * Verification: exactly one '.'; both parts base64url; a 32-byte MAC compared
 * in constant time; the payload split at its LAST two '|'; the purpose the
 * caller expects; issuedAt at most `futureSkewSeconds` ahead of now; a
 * `confirm` token at most `confirmMaxAgeSeconds` old; an `unsubscribe` token
 * never expires. No app secret: nothing is signed and nothing verifies. The
 * links carry the token in the `t` query parameter of the site's confirm and
 * unsubscribe pages.
 */
export const newsletterTokenSpec = {
  keyLabel: 'teleport-newsletter:v1',
  keySecretEnv: 'NEXTAUTH_SECRET',
  separator: '|',
  purposes: ['confirm', 'unsubscribe'] as const,
  confirmMaxAgeSeconds: 7 * 24 * 3600,
  futureSkewSeconds: 300,
  unsubscribeExpires: false,
  maxTokenLength: 1024,
  queryParameter: 't',
  /** One token, for a byte-for-byte check of any other implementation. */
  testVector: {
    secret: 'newsletter-test-vector-secret',
    email: 'reader@example.com',
    purpose: 'unsubscribe' as const,
    issuedAt: 1790000000,
    token:
      'cmVhZGVyQGV4YW1wbGUuY29tfHVuc3Vic2NyaWJlfDE3OTAwMDAwMDA.9xqxAQkmupu1AK9wbvBzMEbua-rdFAsjJHmRS6xrUwk',
  },
}

/** The person columns every statement answers. */
const PERSON_COLUMNS =
  'id, email, source, email_unsubscribed, newsletter_status, newsletter_source, newsletter_unsubscribed_at'
const USERS = NEWSLETTER_USERS_TABLE

/**
 * Every statement the helper runs. Each change of state is guarded in its own
 * WHERE, so two requests at once can never take a row anywhere the policy
 * does not allow (an unsubscribed person subscribed by a form, an event
 * recorded twice). Consent is always written explicitly: a `users` table made
 * before 2026-10-26 still defaults `marketing_consent` to TRUE.
 */
export const NEWSLETTER_SQL = {
  /** `$1`: the address, lower-cased. The exact spelling first, else any case. */
  findPerson: `SELECT ${PERSON_COLUMNS} FROM ${USERS} WHERE LOWER(email) = $1 ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END LIMIT 1`,
  /** `$1` address, `$2` `users.source`, `$3` `newsletter_source`. */
  insertPending: `INSERT INTO ${USERS} (email, source, marketing_consent, newsletter_status, newsletter_source) VALUES ($1, $2, FALSE, 'pending', $3) ON CONFLICT DO NOTHING RETURNING ${PERSON_COLUMNS}`,
  insertSubscribed: `INSERT INTO ${USERS} (email, source, marketing_consent, email_unsubscribed, newsletter_status, newsletter_source, newsletter_subscribed_at) VALUES ($1, $2, TRUE, FALSE, 'subscribed', $3, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING RETURNING ${PERSON_COLUMNS}`,
  /**
   * `$1` id, `$2` `newsletter_source`: only a person never on the list, or
   * still pending, and not opted out of email (an opt-out is undone only by
   * the person's own confirmation click).
   */
  markPending: `UPDATE ${USERS} SET newsletter_status = 'pending', newsletter_source = $2 WHERE id = $1 AND (newsletter_status IS NULL OR newsletter_status = 'pending') AND email_unsubscribed IS NOT TRUE RETURNING ${PERSON_COLUMNS}`,
  markSubscribed: `UPDATE ${USERS} SET newsletter_status = 'subscribed', newsletter_subscribed_at = CURRENT_TIMESTAMP, newsletter_source = $2, marketing_consent = TRUE, email_unsubscribed = FALSE WHERE id = $1 AND (newsletter_status IS NULL OR newsletter_status = 'pending') AND email_unsubscribed IS NOT TRUE RETURNING ${PERSON_COLUMNS}`,
  /** `$1` id: the confirmation link, the person's own click. */
  confirm: `UPDATE ${USERS} SET newsletter_status = 'subscribed', newsletter_subscribed_at = CURRENT_TIMESTAMP, marketing_consent = TRUE, email_unsubscribed = FALSE WHERE id = $1 AND newsletter_status IS DISTINCT FROM 'subscribed' RETURNING ${PERSON_COLUMNS}`,
  unsubscribe: `UPDATE ${USERS} SET newsletter_status = 'unsubscribed', newsletter_unsubscribed_at = CURRENT_TIMESTAMP, marketing_consent = FALSE, email_unsubscribed = TRUE WHERE id = $1 AND newsletter_status IS DISTINCT FROM 'unsubscribed' RETURNING ${PERSON_COLUMNS}`,
}

/** What the confirmation email says when the project's template has no body. */
export const DEFAULT_NEWSLETTER_CONFIRMATION_EMAIL = {
  subject: 'Confirm you want our newsletter',
  body:
    '<p>Please confirm that you want to receive the {{site_name}} newsletter at {{email}}.</p>' +
    '<p><a href="{{confirm_url}}">Yes, send me the newsletter</a></p>' +
    '<p>The link works for 7 days. Did not sign up? Ignore this email: you will not be subscribed unless you click the link.</p>',
}

export interface NewsletterHelperOptions {
  settings: UIDLNewsletterSettings
  /** The `{{site_name}}` of the emails; the request's host when empty. */
  siteName?: string
  /** The project has the in-app event bus (`hasAutomationsBus`). */
  withAutomations?: boolean
  /**
   * The sign-up route sends the account's own welcome email: a person who
   * joins through the sign-up form's box is not sent the newsletter's too.
   */
  signupSendsAccountWelcome?: boolean
}

/** A same-site path without a query or fragment, else `fallback`. */
export const resolveNewsletterPagePath = (value: unknown, fallback: string): string => {
  const path = typeof value === 'string' ? value.trim() : ''
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\?#\s"'<>]/.test(path) ||
    path.indexOf('..') !== -1
  ) {
    return fallback
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

const envNameOf = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : ''

interface EmailCopy {
  subject: string
  body: string
  localized: Record<string, { subject: string; body: string }>
}

const copyOf = (value: unknown): EmailCopy => {
  const template = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const localized: Record<string, { subject: string; body: string }> = {}
  const copies =
    template.localized && typeof template.localized === 'object'
      ? (template.localized as Record<string, unknown>)
      : {}
  for (const [locale, copy] of Object.entries(copies)) {
    const entry = (copy && typeof copy === 'object' ? copy : {}) as Record<string, unknown>
    if (typeof entry.body === 'string' && entry.body) {
      localized[locale] = {
        subject: typeof entry.subject === 'string' ? entry.subject : '',
        body: entry.body,
      }
    }
  }
  return {
    subject: typeof template.subject === 'string' ? template.subject : '',
    body: typeof template.body === 'string' ? template.body : '',
    localized,
  }
}

/** What a welcome email whose body has no `{{unsubscribe_url}}` gets, before `</body>`. */
export const NEWSLETTER_UNSUBSCRIBE_FOOTER =
  '<p style="font-size:12px;color:#6b7280;margin-top:24px">You receive this email because you subscribed to the {{site_name}} newsletter. <a href="{{unsubscribe_url}}">Unsubscribe</a></p>'

/** A newsletter email body that always carries its unsubscribe link. */
export const withUnsubscribeLink = (body: string): string => {
  if (!body || body.indexOf('{{unsubscribe_url}}') !== -1) {
    return body
  }
  const close = body.search(/<\/body>/i)
  return close === -1
    ? body + NEWSLETTER_UNSUBSCRIBE_FOOTER
    : body.slice(0, close) + NEWSLETTER_UNSUBSCRIBE_FOOTER + body.slice(close)
}

const MAILGUN_DOMAIN_READ = "var domain = process.env.MAILGUN_DOMAIN || '';"

/**
 * Each provider's send call, and the same call with the message's own headers
 * (`msg.headers`, the welcome email's `List-Unsubscribe`). MailerSend sets
 * custom headers only on some plans: its emails carry the footer link alone.
 */
const PROVIDER_HEADER_CALLS: Record<string, [string, string]> = {
  resend: [
    'resend.emails.send({ from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html })',
    'resend.emails.send({ from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html, headers: msg.headers || undefined })',
  ],
  sendgrid: [
    'sgMail.send({ to: msg.to, from: from, subject: msg.subject, html: msg.html })',
    'sgMail.send({ to: msg.to, from: from, subject: msg.subject, html: msg.html, headers: msg.headers || undefined })',
  ],
  postmark: [
    'client.sendEmail({ From: sender.header, To: msg.to, Subject: msg.subject, HtmlBody: msg.html })',
    'client.sendEmail({ From: sender.header, To: msg.to, Subject: msg.subject, HtmlBody: msg.html, Headers: msg.headers ? Object.keys(msg.headers).map(function (name) { return { Name: name, Value: msg.headers[name] }; }) : undefined })',
  ],
  mailgun: [
    'mg.messages.create(domain, { from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html })',
    "mg.messages.create(domain, Object.keys(msg.headers || {}).reduce(function (message, name) { message['h:' + name] = msg.headers[name]; return message; }, { from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html }))",
  ],
}

/**
 * The provider send, with the message's headers, and Mailgun's domain read
 * from the env var the settings name. Fails the generation when the shared
 * send no longer reads as expected, so a change there cannot drop them.
 */
const providerSendCode = (provider: string | null): string => {
  let code = generateProviderSendFunction(provider)
  const call = provider ? PROVIDER_HEADER_CALLS[provider] : undefined
  if (call) {
    if (code.indexOf(call[0]) === -1) {
      throw new Error(`The ${provider} send no longer reads as the newsletter expects`)
    }
    code = code.replace(call[0], call[1])
  }
  if (provider !== 'mailgun') {
    return code
  }
  if (code.indexOf(MAILGUN_DOMAIN_READ) === -1) {
    throw new Error('The Mailgun send no longer reads MAILGUN_DOMAIN as the newsletter expects')
  }
  return code.replace(
    MAILGUN_DOMAIN_READ,
    "var domain = (EMAIL_DOMAIN_ENV_NAME ? process.env[EMAIL_DOMAIN_ENV_NAME] : process.env.MAILGUN_DOMAIN) || '';"
  )
}

const eventRecorderCode = (withAutomations: boolean): string =>
  withAutomations
    ? `// The project has automations: joining and leaving wake them. Best effort:
// recording can never fail the request. One event per person per minute
// (the dedupe key's minute), so a later re-subscribe is an event of its own.
async function recordNewsletterEvent(type, row, req) {
  try {
    var id = row && row.id != null ? String(row.id) : '';
    if (!id) { return; }
    var email = row.email ? String(row.email) : '';
    var bus = require('${RELATIVE_PREFIX}/${AUTOMATIONS_PATH.join('/')}/event-bus');
    await bus.emitBusinessEvent({
      type: type,
      entityType: 'subscriber',
      entityId: id,
      payload: {
        subscriber: {
          email: email,
          source: row.source ? String(row.source) : null,
          consent: type === 'newsletter-subscribed',
        },
      },
      actor: email,
      actorType: 'customer',
      dedupeKey: type + ':' + id + ':' + Math.floor(Date.now() / 60000),
    }, req);
  } catch (eventErr) {
    console.error('[newsletter] could not record the ' + type + ' event:', eventErr && eventErr.message ? eventErr.message : eventErr);
  }
}`
    : `// The project has no automations: nothing listens for newsletter events.
async function recordNewsletterEvent() {}`

export const generateNewsletterHelperCode = (options: NewsletterHelperOptions): string => {
  const { settings } = options
  const email = settings.email || ({} as UIDLNewsletterSettings['email'])
  const provider =
    email.provider && SUPPORTED_EMAIL_PROVIDERS.has(email.provider) ? email.provider : null
  const confirmation = copyOf(settings.templates && settings.templates.confirmation)
  if (!confirmation.body) {
    confirmation.subject = confirmation.subject || DEFAULT_NEWSLETTER_CONFIRMATION_EMAIL.subject
    confirmation.body = DEFAULT_NEWSLETTER_CONFIRMATION_EMAIL.body
  }
  const welcome = copyOf(settings.templates && settings.templates.welcome)
  // A newsletter email always carries its way out.
  welcome.body = withUnsubscribeLink(welcome.body)
  for (const locale of Object.keys(welcome.localized)) {
    welcome.localized[locale].body = withUnsubscribeLink(welcome.localized[locale].body)
  }
  const sender = settings.sender || { name: '', email: '' }
  const pages = settings.pages || ({} as UIDLNewsletterSettings['pages'])

  return `'use strict';
/**
 * The newsletter (generated): how a person joins it and leaves it. Every
 * writer of the newsletter state goes through this module.
 */
var crypto = require('crypto');
var __security = require('${securityRuntimeSpecifier(RELATIVE_PREFIX)}');
${generateEmailLocaleRequire(RELATIVE_PREFIX)}
${
  provider
    ? `var __sentEmailLog = require('${RELATIVE_PREFIX}/utils/email/sent-email-log');`
    : 'var __sentEmailLog = null;'
}

${generateLazyPgClientCode()}

var CONFIRMATION_REQUIRED = ${settings.confirmation === true};
var WELCOME_ENABLED = ${settings.welcome === true && !!welcome.body};
var SIGNUP_SENDS_ACCOUNT_WELCOME = ${options.signupSendsAccountWelcome === true};
var SITE_NAME = ${JSON.stringify(options.siteName || '')};
var SENDER_NAME = ${JSON.stringify(typeof sender.name === 'string' ? sender.name : '')};
var SENDER_EMAIL = ${JSON.stringify(typeof sender.email === 'string' ? sender.email : '')};
var EMAIL_PROVIDER = ${JSON.stringify(provider)};
var EMAIL_SECRET_ENV_NAME = ${JSON.stringify(envNameOf(email.apiKeyEnv))};
var EMAIL_DOMAIN_ENV_NAME = ${JSON.stringify(envNameOf(email.domainEnv))};
var CONFIRMATION_EMAIL = ${JSON.stringify({
    subject: confirmation.subject,
    body: confirmation.body,
  })};
var CONFIRMATION_EMAIL_LOCALIZED = ${JSON.stringify(confirmation.localized)};
var WELCOME_EMAIL = ${JSON.stringify({ subject: welcome.subject, body: welcome.body })};
var WELCOME_EMAIL_LOCALIZED = ${JSON.stringify(welcome.localized)};
var CONFIRM_PAGE_PATH = ${JSON.stringify(
    resolveNewsletterPagePath(pages.confirm, DEFAULT_NEWSLETTER_CONFIRM_PATH)
  )};
var UNSUBSCRIBE_PAGE_PATH = ${JSON.stringify(
    resolveNewsletterPagePath(pages.unsubscribe, DEFAULT_NEWSLETTER_UNSUBSCRIBE_PATH)
  )};
var UNSUBSCRIBE_ROUTE = ${JSON.stringify(NEWSLETTER_UNSUBSCRIBE_URL)};

// Every sign-up answers after at least this long, whatever happened.
var NEWSLETTER_MIN_RESPONSE_MS = ${NEWSLETTER_MIN_RESPONSE_MS};
// Sign-ups one address may make per hour (counted for every address).
var ADDRESS_LIMIT = ${NEWSLETTER_ADDRESS_LIMIT};
var NEWSLETTER_SOURCES = ${JSON.stringify(NEWSLETTER_SOURCES)};
var VISITOR_SIGN_UP_POINTS = ${JSON.stringify(VISITOR_SIGN_UP_POINTS)};
// The sign-up points of the site's pages: all the public sign-up route takes.
var PUBLIC_ROUTE_SIGN_UP_POINTS = ${JSON.stringify(PUBLIC_ROUTE_SIGN_UP_POINTS)};
// An address that opted out is sent at most this many confirmation links a day.
var OPTED_OUT_CONFIRMATIONS_PER_DAY = ${NEWSLETTER_OPTED_OUT_CONFIRMATIONS_PER_DAY};
// Where a row the newsletter adds came from (users.source); 'newsletter' for
// the newsletter's own sign-up points.
var ACCOUNT_SOURCE_OF_POINT = { signup: 'signup', checkout: 'checkout', booking: 'booking', form: 'form', import: 'import', manual: 'manual' };

var TOKEN_KEY_LABEL = ${JSON.stringify(newsletterTokenSpec.keyLabel)};
var TOKEN_PURPOSES = ${JSON.stringify(newsletterTokenSpec.purposes)};
var CONFIRM_TOKEN_MAX_AGE_SECONDS = ${newsletterTokenSpec.confirmMaxAgeSeconds};
var TOKEN_FUTURE_SKEW_SECONDS = ${newsletterTokenSpec.futureSkewSeconds};
var TOKEN_MAX_LENGTH = ${newsletterTokenSpec.maxTokenLength};

var SQL = ${JSON.stringify(NEWSLETTER_SQL, null, 2)};

/** The address as the newsletter keeps it (trimmed, lower-cased), or '' when it is not one. */
function normalizeEmail(value) {
  var email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length < 3 || email.length > 254 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { return ''; }
  return email;
}

/** A sign-up point a visitor's request names; 'block' for anything else. */
function visitorSignUpPoint(value) {
  return VISITOR_SIGN_UP_POINTS.indexOf(value) !== -1 ? value : 'block';
}

/** The sign-up point the public route takes from its body: a page's own, else 'block'. */
function publicRouteSignUpPoint(value) {
  return PUBLIC_ROUTE_SIGN_UP_POINTS.indexOf(value) !== -1 ? value : 'block';
}

/**
 * What a log line may keep of an error: its code and message, never a
 * database row (pg's \`detail\`) or anything else it carries.
 */
function safeError(err) {
  return {
    code: err && err.code ? String(err.code) : null,
    message: err && err.message ? String(err.message) : String(err),
  };
}

function signUpPointOf(value) {
  return NEWSLETTER_SOURCES.indexOf(value) !== -1 ? value : 'block';
}

/**
 * What every sign-up answers: the same for a new address, a known one, an
 * unsubscribed one, a limited one and a bot. \`pending\` is the settings' (a
 * confirmation email is on its way when double opt-in is on), never the
 * address's.
 */
function publicSubscribeAnswer() {
  return { ok: true, pending: CONFIRMATION_REQUIRED };
}

function waitUntilElapsed(startedAt, ms) {
  var left = ms - (Date.now() - startedAt);
  return left > 0 ? new Promise(function (resolve) { setTimeout(resolve, left); }) : Promise.resolve();
}

/** Runs \`fn(db)\` on one connection to the site's database, closed afterwards. */
async function withNewsletterDb(fn) {
  var client = getClient();
  if (typeof client.on === 'function') { client.on('error', function () {}); }
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try { await client.end(); } catch (_e) {}
  }
}

function rowOf(result) {
  return result && result.rows && result.rows[0] ? result.rows[0] : null;
}

// ---------------------------------------------------------------------------
// The links' tokens (see newsletterTokenSpec in the code generator)
// ---------------------------------------------------------------------------

var __tokenKeyCache = { secret: null, key: null };

function newsletterTokenKey() {
  var secret = process.env.NEXTAUTH_SECRET || '';
  if (!secret) { return null; }
  if (__tokenKeyCache.secret !== secret) {
    __tokenKeyCache = { secret: secret, key: crypto.createHmac('sha256', secret).update(TOKEN_KEY_LABEL).digest() };
  }
  return __tokenKeyCache.key;
}

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (typeof text !== 'string' || !text || !/^[A-Za-z0-9_-]+$/.test(text)) { return null; }
  var base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) { base64 += '='; }
  return Buffer.from(base64, 'base64');
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

/** The token of a confirm or unsubscribe link for \`email\`; null without the app secret. */
function signNewsletterToken(email, purpose, issuedAt) {
  var key = newsletterTokenKey();
  var address = normalizeEmail(email);
  if (!key || !address || TOKEN_PURPOSES.indexOf(purpose) === -1) { return null; }
  var at = issuedAt === undefined ? nowSeconds() : Math.floor(Number(issuedAt));
  if (!isFinite(at) || at < 0) { return null; }
  var payload = Buffer.from(address + '|' + purpose + '|' + at, 'utf8');
  return toBase64Url(payload) + '.' + toBase64Url(crypto.createHmac('sha256', key).update(payload).digest());
}

/** \`{ email, purpose, issuedAt }\` for a live token of \`purpose\`, else null. */
function verifyNewsletterToken(token, purpose) {
  var key = newsletterTokenKey();
  if (!key || typeof token !== 'string' || token.length > TOKEN_MAX_LENGTH || TOKEN_PURPOSES.indexOf(purpose) === -1) { return null; }
  var parts = token.trim().split('.');
  if (parts.length !== 2) { return null; }
  var payload = fromBase64Url(parts[0]);
  var mac = fromBase64Url(parts[1]);
  if (!payload || !mac || mac.length !== 32) { return null; }
  var expected = crypto.createHmac('sha256', key).update(payload).digest();
  if (!crypto.timingSafeEqual(mac, expected)) { return null; }
  var text = payload.toString('utf8');
  var last = text.lastIndexOf('|');
  var middle = last > 0 ? text.lastIndexOf('|', last - 1) : -1;
  if (middle <= 0) { return null; }
  var email = text.slice(0, middle);
  var issued = text.slice(last + 1);
  if (text.slice(middle + 1, last) !== purpose || !/^[0-9]{1,12}$/.test(issued) || normalizeEmail(email) !== email) { return null; }
  var issuedAt = Number(issued);
  var now = nowSeconds();
  if (issuedAt > now + TOKEN_FUTURE_SKEW_SECONDS) { return null; }
  if (purpose === 'confirm' && now - issuedAt > CONFIRM_TOKEN_MAX_AGE_SECONDS) { return null; }
  return { email: email, purpose: purpose, issuedAt: issuedAt };
}

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------

${TRUSTED_ORIGIN_CODE}

${generateFillTemplateFn()}

${providerSendCode(provider)}

function siteNameOf(req) {
  if (SITE_NAME) { return SITE_NAME; }
  var host = req && req.headers && req.headers.host ? String(req.headers.host) : '';
  return host.replace(/^www\\./, '').split(':')[0];
}

function senderAddress() {
  var email = String(SENDER_EMAIL || process.env.EMAIL_FROM || '').trim();
  if (!email) { return ''; }
  var name = String(SENDER_NAME || '').replace(/[\\r\\n<>"]/g, '').trim();
  return name && email.indexOf('<') === -1 ? name + ' <' + email + '>' : email;
}

function emailCredential() {
  var apiKey = EMAIL_SECRET_ENV_NAME ? process.env[EMAIL_SECRET_ENV_NAME] : '';
  if (apiKey && String(apiKey).indexOf('teleporthq.secrets.') === 0) { apiKey = ''; }
  return apiKey ? String(apiKey) : '';
}

/** Whether the site can mail a newsletter email at all (a provider, its credential, a sender). */
function canSendNewsletterEmail() {
  return !!EMAIL_PROVIDER && !!emailCredential() && !!senderAddress();
}

// A link to one of the site's pages carries the token in its fragment: a
// fragment never reaches a server, a CDN log or a Referer (the page's first
// head script keeps it). The site's own unsubscribe route reads it on the
// server, so a link to it carries it in the query.
function pageLink(path, token) {
  return path + (path.indexOf('/api/') === 0 ? '?t=' : '#t=') + encodeURIComponent(token);
}

// The token, wherever it appears, for what the sent-email log keeps: whoever
// reads the log cannot confirm or unsubscribe someone else with it.
function hideToken(text, token) {
  return String(text == null ? '' : text).split(token).join('[hidden]');
}

/**
 * Mails the \`confirmation\` (its link confirms the subscription) or the
 * \`welcome\` (its link unsubscribes) email to \`toEmail\`, in \`locale\`'s copy,
 * with links to this site's pages. Recorded in the sent-email log, the
 * token hidden. Resolves whether it was sent; never throws.
 */
async function sendNewsletterEmail(kind, toEmail, locale, req, userId) {
  var to = normalizeEmail(toEmail);
  var template = kind === 'confirmation' ? CONFIRMATION_EMAIL : kind === 'welcome' ? WELCOME_EMAIL : null;
  if (!template || !to) { return false; }
  if (!EMAIL_PROVIDER) { console.warn('[newsletter] ' + kind + ' email not sent: no email provider is configured'); return false; }
  var apiKey = emailCredential();
  if (!apiKey) { console.warn('[newsletter] ' + kind + ' email not sent: the email credential is not set'); return false; }
  var from = senderAddress();
  if (!from) { console.warn('[newsletter] ' + kind + ' email not sent: no sender is configured'); return false; }
  var purpose = kind === 'confirmation' ? 'confirm' : 'unsubscribe';
  var token = signNewsletterToken(to, purpose);
  if (!token) { console.warn('[newsletter] ' + kind + ' email not sent: the app secret is not set'); return false; }
  var link = trustedOrigin(req) + pageLink(kind === 'confirmation' ? CONFIRM_PAGE_PATH : UNSUBSCRIBE_PAGE_PATH, token);
  var values = kind === 'confirmation'
    ? { confirm_url: link, site_name: siteNameOf(req), email: to }
    : { unsubscribe_url: link, site_name: siteNameOf(req), email: to };
  var copy = __emailLocale.pickLocalizedTemplate(template, kind === 'confirmation' ? CONFIRMATION_EMAIL_LOCALIZED : WELCOME_EMAIL_LOCALIZED, locale);
  if (!copy.body) { return false; }
  var subject = fillSubjectTemplate(copy.subject, values);
  var html = fillTemplate(copy.body, values);
  // The welcome is a newsletter message: mail clients offer its way out too,
  // through the route that reads the token on the server and asks first.
  var headers = kind === 'welcome' ? { 'List-Unsubscribe': '<' + trustedOrigin(req) + UNSUBSCRIBE_ROUTE + '?t=' + encodeURIComponent(token) + '>' } : undefined;
  var failure = null;
  try {
    await __sendProviderEmail({ from: from, to: to, subject: subject, html: html, apiKey: apiKey, headers: headers });
  } catch (err) {
    failure = err;
  }
  if (__sentEmailLog) {
    __sentEmailLog.recordSentEmail({
      emailType: 'newsletter-' + kind,
      audience: 'customer',
      to: to,
      from: from,
      subject: hideToken(subject, token),
      html: hideToken(html, token),
      payload: { recipientEmail: to },
      provider: EMAIL_PROVIDER,
      status: failure ? 'failed' : 'sent',
      error: failure ? (failure.message || String(failure)) : null,
      source: 'newsletter',
      sourceRef: 'utils/newsletter',
      userId: userId != null ? userId : null,
    });
    await __sentEmailLog.settleSentEmailLog();
  }
  if (failure) {
    // A provider may echo the recipient: the log never keeps it.
    console.error('[newsletter] the ' + kind + ' email could not be sent:', String(failure.message || failure).split(to).join('[address]'));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

${eventRecorderCode(options.withAutomations === true)}

// ---------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------

async function findPerson(db, email) {
  return rowOf(await db.query(SQL.findPerson, [email]));
}

// The person is on the list now: the automations hear of it, and they are
// welcomed (not when they joined through the sign-up form whose route sends
// the account's own welcome; an \`account\` sign-up, the account page's
// switch, is welcomed like any other).
async function joinedNewsletter(row, point, locale, req) {
  await recordNewsletterEvent('newsletter-subscribed', row, req);
  if (WELCOME_ENABLED && !(point === 'signup' && SIGNUP_SENDS_ACCOUNT_WELCOME)) {
    await sendNewsletterEmail('welcome', row.email, locale, req, row.id);
  }
}

/**
 * Adds \`email\` to the newsletter from \`signUpPoint\` (a \`newsletter_source\`).
 * The caller handled the honeypot and answers \`publicSubscribeAnswer()\`
 * whatever this resolves: \`{ outcome }\`, one of
 *   'invalid'       not an address;
 *   'limited'       this address signed up ${NEWSLETTER_ADDRESS_LIMIT} times this hour, or an
 *                   opted-out address was already sent its confirmation today;
 *   'already'       already subscribed: nothing changes, nothing is sent;
 *   'confirm-sent'  a confirmation link was mailed (double opt-in, or an
 *                   address that unsubscribed or opted out of email: nothing
 *                   is written);
 *   'pending'       double opt-in, but no confirmation email could go out;
 *   'noop'          an unsubscribed address and no way to mail it;
 *   'subscribed'    single opt-in: on the list now (event, welcome email).
 */
async function subscribeNewsletterPerson(input) {
  var o = input || {};
  var db = o.db;
  var req = o.req;
  var email = normalizeEmail(o.email);
  if (!email) { return { outcome: 'invalid' }; }
  var point = signUpPointOf(o.signUpPoint);
  var limit = await __security.rateLimit({ key: 'newsletter:' + email, limit: ADDRESS_LIMIT, windowSeconds: 3600 });
  if (!limit.allowed) { return { outcome: 'limited' }; }
  var locale = __emailLocale.resolveRequestLocale(req);
  var accountSource = ACCOUNT_SOURCE_OF_POINT[point] || 'newsletter';
  // Twice at most: a row that changed between the read and the write is read again.
  for (var attempt = 0; attempt < 2; attempt++) {
    var person = await findPerson(db, email);
    if (person && person.newsletter_status === 'subscribed') { return { outcome: 'already' }; }
    if (person && (person.newsletter_status === 'unsubscribed' || person.email_unsubscribed === true)) {
      // Anyone can type anyone's address: a form never undoes an opt-out (off
      // the newsletter, or off every marketing email). The address's owner is
      // asked to confirm instead, at most once a day, and nothing is written.
      if (!canSendNewsletterEmail()) { return { outcome: 'noop' }; }
      var daily = await __security.rateLimit({ key: 'newsletter-resubscribe:' + email, limit: OPTED_OUT_CONFIRMATIONS_PER_DAY, windowSeconds: 86400 });
      if (!daily.allowed) { return { outcome: 'limited' }; }
      var resent = await sendNewsletterEmail('confirmation', email, locale, req, person.id);
      return { outcome: resent ? 'confirm-sent' : 'noop' };
    }
    if (CONFIRMATION_REQUIRED) {
      var pending = rowOf(person
        ? await db.query(SQL.markPending, [person.id, point])
        : await db.query(SQL.insertPending, [email, accountSource, point]));
      if (!pending) { continue; }
      var sent = await sendNewsletterEmail('confirmation', email, locale, req, pending.id);
      return { outcome: sent ? 'confirm-sent' : 'pending' };
    }
    var joined = rowOf(person
      ? await db.query(SQL.markSubscribed, [person.id, point])
      : await db.query(SQL.insertSubscribed, [email, accountSource, point]));
    if (!joined) { continue; }
    await joinedNewsletter(joined, point, locale, req);
    return { outcome: 'subscribed' };
  }
  return { outcome: 'noop' };
}

/**
 * The confirmation link: \`{ ok: true, email }\` once the person is subscribed
 * (opening it again answers the same), \`{ ok: false }\` for a link that is
 * not one, expired (${
   newsletterTokenSpec.confirmMaxAgeSeconds / 86400
 } days), or mailed before the person last unsubscribed.
 */
async function confirmNewsletter(input) {
  var o = input || {};
  var claim = verifyNewsletterToken(o.token, 'confirm');
  if (!claim) { return { ok: false }; }
  var person = await findPerson(o.db, claim.email);
  if (!person) { return { ok: false }; }
  if (person.newsletter_status === 'subscribed') { return { ok: true, email: claim.email }; }
  var leftAt = person.newsletter_unsubscribed_at ? new Date(person.newsletter_unsubscribed_at).getTime() : NaN;
  if (isFinite(leftAt) && claim.issuedAt < Math.floor(leftAt / 1000)) { return { ok: false }; }
  var confirmed = rowOf(await o.db.query(SQL.confirm, [person.id]));
  if (confirmed) {
    await joinedNewsletter(confirmed, confirmed.newsletter_source, __emailLocale.resolveRequestLocale(o.req), o.req);
  }
  return { ok: true, email: claim.email };
}

/**
 * The unsubscribe link: \`{ ok: true, email }\` once the person is off the list
 * (idempotent: the event is recorded once, when a subscriber leaves),
 * \`{ ok: false }\` for a link that is not one.
 */
async function unsubscribeNewsletter(input) {
  var o = input || {};
  var claim = verifyNewsletterToken(o.token, 'unsubscribe');
  if (!claim) { return { ok: false }; }
  var person = await findPerson(o.db, claim.email);
  if (!person || person.newsletter_status === 'unsubscribed') { return { ok: true, email: claim.email }; }
  var left = rowOf(await o.db.query(SQL.unsubscribe, [person.id]));
  if (left && person.newsletter_status === 'subscribed') {
    await recordNewsletterEvent('newsletter-unsubscribed', left, o.req);
  }
  return { ok: true, email: claim.email };
}

module.exports = {
  NEWSLETTER_MIN_RESPONSE_MS: NEWSLETTER_MIN_RESPONSE_MS,
  normalizeEmail: normalizeEmail,
  visitorSignUpPoint: visitorSignUpPoint,
  publicRouteSignUpPoint: publicRouteSignUpPoint,
  safeError: safeError,
  publicSubscribeAnswer: publicSubscribeAnswer,
  waitUntilElapsed: waitUntilElapsed,
  withNewsletterDb: withNewsletterDb,
  subscribeNewsletterPerson: subscribeNewsletterPerson,
  confirmNewsletter: confirmNewsletter,
  unsubscribeNewsletter: unsubscribeNewsletter,
  signNewsletterToken: signNewsletterToken,
  verifyNewsletterToken: verifyNewsletterToken,
  sendNewsletterEmail: sendNewsletterEmail,
  recordNewsletterEvent: recordNewsletterEvent,
};
`
}
