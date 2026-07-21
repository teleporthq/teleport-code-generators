/**
 * Shared building blocks for generated server routes that send a transactional
 * email (account-delete farewell, account-signup welcome). Keeps the provider
 * dispatch, template filler, dependency map, and config-key list in ONE place so
 * every route stays byte-for-byte consistent.
 */
import { getEmailProviderDependencies } from './invoice/email-sender-code'

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

// Provider-specific `__sendProviderEmail({ from, to, subject, html, apiKey })`.
// No attachment (unlike the invoice sender). When no provider is configured the
// function is a no-op so the route stays self-contained and never throws.
export const generateProviderSendFunction = (provider?: string | null): string => {
  switch (provider) {
    case 'resend':
      return `async function __sendProviderEmail(msg) {
  var Resend = require('resend').Resend;
  var resend = new Resend(msg.apiKey);
  var result = await resend.emails.send({ from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html });
  if (result && result.error) { throw new Error(result.error.message || 'Failed to send email'); }
}`
    case 'sendgrid':
      return `async function __sendProviderEmail(msg) {
  var sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(msg.apiKey);
  await sgMail.send({ to: msg.to, from: msg.from, subject: msg.subject, html: msg.html });
}`
    case 'postmark':
      return `async function __sendProviderEmail(msg) {
  var postmark = require('postmark');
  var client = new postmark.ServerClient(msg.apiKey);
  await client.sendEmail({ From: msg.from, To: msg.to, Subject: msg.subject, HtmlBody: msg.html });
}`
    case 'mailgun':
      return `async function __sendProviderEmail(msg) {
  var Mailgun = require('mailgun.js');
  var formData = require('form-data');
  var domain = process.env.MAILGUN_DOMAIN || '';
  if (!domain) { throw new Error('Mailgun domain not configured'); }
  var mailgun = new Mailgun(formData);
  var mg = mailgun.client({ username: 'api', key: msg.apiKey });
  await mg.messages.create(domain, { from: msg.from, to: [msg.to], subject: msg.subject, html: msg.html });
}`
    case 'mailersend':
      return `async function __sendProviderEmail(msg) {
  var MailerSend = require('mailersend').MailerSend;
  var EmailParams = require('mailersend').EmailParams;
  var Sender = require('mailersend').Sender;
  var Recipient = require('mailersend').Recipient;
  var mailerSend = new MailerSend({ apiKey: msg.apiKey });
  var fromStr = String(msg.from || '').trim();
  var m = /^(.*)<([^<>]+)>\\s*$/.exec(fromStr);
  var fromEmail = m ? m[2].trim() : fromStr;
  var fromName = m ? m[1].trim() : '';
  var sender = new Sender(fromEmail, fromName || fromEmail);
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
]
