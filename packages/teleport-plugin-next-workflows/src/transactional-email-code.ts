/**
 * Shared building blocks for generated server routes that send a transactional
 * email (account-delete farewell, account-signup welcome). Keeps the provider
 * dispatch, template filler, dependency map, and config-key list in ONE place so
 * every route stays byte-for-byte consistent.
 */
import { UIDLLocalizedEmailTemplates } from '@teleporthq/teleport-types'
import { EmailSender } from '@teleporthq/teleport-shared'
import { getEmailProviderDependencies } from './invoice/email-sender-code'
import { EMAIL_LOCALE_FILE_NAME, EMAIL_LOCALE_PATH } from './email-locale/email-locale-scope'

export const SUPPORTED_EMAIL_PROVIDERS = new Set([
  'resend',
  'sendgrid',
  'postmark',
  'mailgun',
  'mailersend',
])

// npm deps for a provider (reuses the invoice sender's version map). Empty for
// an unknown/absent provider.
export const transactionalEmailDependencies = (
  provider?: string | null
): Record<string, string> => {
  if (!provider || !SUPPORTED_EMAIL_PROVIDERS.has(provider)) {
    return {}
  }
  return getEmailProviderDependencies(provider)
}

/**
 * Where a transactional route's sends are recorded in the sent-email ledger:
 * the purpose slug, the `source` column and the route file, plus the require
 * prefix from the route's directory back to the project root.
 */
export interface TransactionalEmailLedger {
  emailType: string
  source: string
  sourceRef: string
  relativePrefix: string
  /**
   * Records the send without the recipient's details: `msg.recordedTo` in
   * place of the address, and neither the body nor the values it was filled
   * with. For an email to someone whose details the route is removing (the
   * farewell after an account deletion).
   */
  withoutRecipientDetails?: boolean
}

// Provider-specific `__sendProviderEmail({ from, fromName?, to, recordedTo?,
// subject, html, apiKey, tokenValues?, userId? })`, preceded by the `__emailSender` helper that
// names the sender. No attachment (unlike the invoice sender). When no provider
// is configured the function is a no-op so the route stays self-contained and
// never throws. With `ledger`, the provider function is emitted as
// `__sendProviderEmailRaw` and `__sendProviderEmail` records every attempt
// (success or throw) before returning / rethrowing.
export const generateProviderSendFunction = (
  provider?: string | null,
  ledger?: TransactionalEmailLedger
): string => {
  const raw = generateRawProviderSendFunction(provider)
  if (!provider || !SUPPORTED_EMAIL_PROVIDERS.has(provider)) {
    return raw
  }
  const senderHelper = EmailSender.generateEmailSenderHelperCode()
  if (!ledger) {
    return `${senderHelper}
${raw}`
  }
  return `${senderHelper}
${raw.replace('async function __sendProviderEmail(', 'async function __sendProviderEmailRaw(')}

var __sentEmailLog = require('${ledger.relativePrefix}/utils/email/sent-email-log');

async function __sendProviderEmail(msg) {
  var failure = null;
  try {
    await __sendProviderEmailRaw(msg);
  } catch (err) {
    failure = err;
  }
  var sender = __emailSender({ from: msg.from, name: msg.fromName });
  // Recorded in the background; the route settles the ledger before it replies.
  __sentEmailLog.recordSentEmail({
    emailType: ${JSON.stringify(ledger.emailType)},
    audience: 'customer',
    to: ${ledger.withoutRecipientDetails ? 'msg.recordedTo' : 'msg.to'},
    from: sender.email,
    fromName: sender.name,
    subject: msg.subject,
    html: ${ledger.withoutRecipientDetails ? "''" : 'msg.html'},
    payload: ${ledger.withoutRecipientDetails ? 'null' : 'msg.tokenValues'},
    provider: ${JSON.stringify(provider)},
    status: failure ? 'failed' : 'sent',
    error: failure ? (failure.message || String(failure)) : null,
    source: ${JSON.stringify(ledger.source)},
    sourceRef: ${JSON.stringify(ledger.sourceRef)},
    userId: msg.userId,
  });
  if (failure) { throw failure; }
}`
}

const generateRawProviderSendFunction = (provider?: string | null): string => {
  switch (provider) {
    case 'resend':
      return `async function __sendProviderEmail(msg) {
  var Resend = require('resend').Resend;
  var resend = new Resend(msg.apiKey);
  var sender = __emailSender({ from: msg.from, name: msg.fromName });
  var result = await resend.emails.send({ from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html });
  if (result && result.error) { throw new Error(result.error.message || 'Failed to send email'); }
}`
    case 'sendgrid':
      // SendGrid reads a "Name <email>" string's name verbatim, quotes included,
      // so a named sender goes as its two parts.
      return `async function __sendProviderEmail(msg) {
  var sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(msg.apiKey);
  var sender = __emailSender({ from: msg.from, name: msg.fromName });
  var from = sender.name ? { email: sender.email, name: sender.name } : sender.email;
  await sgMail.send({ to: msg.to, from: from, subject: msg.subject, html: msg.html });
}`
    case 'postmark':
      return `async function __sendProviderEmail(msg) {
  var postmark = require('postmark');
  var client = new postmark.ServerClient(msg.apiKey);
  var sender = __emailSender({ from: msg.from, name: msg.fromName });
  await client.sendEmail({ From: sender.header, To: msg.to, Subject: msg.subject, HtmlBody: msg.html });
}`
    case 'mailgun':
      return `async function __sendProviderEmail(msg) {
  var Mailgun = require('mailgun.js');
  var formData = require('form-data');
  var domain = process.env.MAILGUN_DOMAIN || '';
  if (!domain) { throw new Error('Mailgun domain not configured'); }
  var mailgun = new Mailgun(formData);
  var mg = mailgun.client({ username: 'api', key: msg.apiKey });
  var sender = __emailSender({ from: msg.from, name: msg.fromName });
  await mg.messages.create(domain, { from: sender.header, to: [msg.to], subject: msg.subject, html: msg.html });
}`
    case 'mailersend':
      return `async function __sendProviderEmail(msg) {
  var MailerSend = require('mailersend').MailerSend;
  var EmailParams = require('mailersend').EmailParams;
  var Sender = require('mailersend').Sender;
  var Recipient = require('mailersend').Recipient;
  var mailerSend = new MailerSend({ apiKey: msg.apiKey });
  var from = __emailSender({ from: msg.from, name: msg.fromName });
  var sender = new Sender(from.email, from.name || from.email);
  var params = new EmailParams().setFrom(sender).setTo([new Recipient(msg.to)]).setSubject(msg.subject).setHtml(msg.html);
  await mailerSend.email.send(params);
}`
    default:
      return `async function __sendProviderEmail(_msg) {
  // No email provider configured — skip.
}`
  }
}

// Emits the `fillTemplate(str, values)` flat `{{key}}` replacer used to fill the
// email subject/body tokens at send time.
export const generateFillTemplateFn = (): string => `function fillTemplate(str, values) {
  if (!str) { return ''; }
  var out = String(str);
  var keys = Object.keys(values);
  for (var i = 0; i < keys.length; i++) {
    var v = values[keys[i]];
    out = out.split('{{' + keys[i] + '}}').join(v == null ? '' : String(v));
  }
  return out;
}`

/**
 * The per-language copies of a transactional route's email, as the UIDL mapper
 * wrote them on the node config. Anything that is not a locale→copy map is
 * treated as "no copies", so a hand-edited config can never break the route.
 */
export const readLocalizedEmailTemplates = (value: unknown): UIDLLocalizedEmailTemplates => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const copies: UIDLLocalizedEmailTemplates = {}
  for (const [locale, copy] of Object.entries(value as Record<string, unknown>)) {
    if (!copy || typeof copy !== 'object') {
      continue
    }
    const { body, subject } = copy as { body?: unknown; subject?: unknown }
    if (typeof body !== 'string' || !body) {
      continue
    }
    copies[locale] = typeof subject === 'string' && subject ? { body, subject } : { body }
  }
  return copies
}

/** The `require` of the shared locale module from a route `relativePrefix` deep. */
export const generateEmailLocaleRequire = (relativePrefix: string): string =>
  `var __emailLocale = require('${relativePrefix}/${EMAIL_LOCALE_PATH.join(
    '/'
  )}/${EMAIL_LOCALE_FILE_NAME}');`

/**
 * Emits `function <fnName>(locale)` returning `{ subject, body, locale }` — the
 * copy of the route's email for the language a request came from, read from
 * the baked constants. The default language and any language without a copy
 * fall back to the base subject/body.
 */
export const generateLocalizedEmailCopyFn = (params: {
  fnName: string
  subjectConst: string
  bodyConst: string
  localizedConst: string
}): string => `function ${params.fnName}(locale) {
  return __emailLocale.pickLocalizedTemplate(
    { subject: ${params.subjectConst}, body: ${params.bodyConst} },
    ${params.localizedConst},
    locale
  );
}`

// The account-signup node's welcome-email config keys. They must NEVER be
// forwarded from the client signup handler to /api/auth/signup nor inserted as
// user columns (they'd corrupt createUser and leak into the client bundle).
export const WELCOME_EMAIL_CONFIG_KEYS = [
  'emailProvider',
  'from',
  'fromName',
  'apiKey',
  'serverToken',
  'subject',
  'body',
  'bodySource',
  'bodyComponentId',
  'bodyTemplatePurpose',
  'templateParams',
  'localizedTemplates',
]
