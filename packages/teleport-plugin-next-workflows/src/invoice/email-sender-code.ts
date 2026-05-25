import { UIDLInvoiceEmailDelivery } from '@teleporthq/teleport-types'

export const generateEmailSenderCode = (emailDelivery: UIDLInvoiceEmailDelivery): string => {
  if (!emailDelivery || !emailDelivery.enabled || !emailDelivery.provider) {
    return `module.exports = { sendInvoiceEmail: async function() { return { success: false, error: 'Email delivery not configured' }; } };`
  }

  const secretKeysJson = JSON.stringify(emailDelivery.secretKeys || {})
  const fromEmail = emailDelivery.fromEmail || ''
  const fromName = emailDelivery.fromName || ''
  const subjectTemplate = emailDelivery.subject || 'Invoice {{invoiceNumber}}'
  const bodyTemplate = emailDelivery.body || '<p>Please find your invoice attached.</p>'

  return `/**
 * Invoice Email Sender
 * Provider: ${emailDelivery.provider}
 */

var pdfGenerator = require('./pdf-generator');
var replacePlaceholders = pdfGenerator.replacePlaceholders;

var SECRET_KEYS = ${secretKeysJson};

function resolveSecretKey(keyName) {
  var envName = SECRET_KEYS[keyName];
  if (envName && process.env[envName]) return process.env[envName];
  if (process.env[keyName]) return process.env[keyName];
  return '';
}

function buildEmailData(invoiceData) {
  var data = pdfGenerator.buildDataContext(invoiceData);
  return {
    subject: replacePlaceholders(${JSON.stringify(subjectTemplate)}, data),
    body: replacePlaceholders(${JSON.stringify(bodyTemplate)}, data),
    to: invoiceData.customerEmail || '',
    from: ${JSON.stringify(fromName ? `${fromName} <${fromEmail}>` : fromEmail)},
  };
}

${generateProviderSendFunction(emailDelivery.provider)}

module.exports = { sendInvoiceEmail };
`
}

function generateProviderSendFunction(provider: string): string {
  switch (provider) {
    case 'resend':
      return `
async function sendInvoiceEmail(invoiceData, pdfBuffer) {
  try {
    var Resend = require('resend').Resend;
    var apiKey = resolveSecretKey('apiKey');
    if (!apiKey) return { success: false, error: 'Resend API key not configured' };
    var resend = new Resend(apiKey);
    var emailData = buildEmailData(invoiceData);
    if (!emailData.to) return { success: false, error: 'No customer email provided' };

    var payload = {
      from: emailData.from,
      to: [emailData.to],
      subject: emailData.subject,
      html: emailData.body,
      attachments: [{
        filename: (invoiceData.invoiceNumber || 'invoice') + '.pdf',
        content: pdfBuffer.toString('base64'),
      }],
    };
    var result = await resend.emails.send(payload);
    if (result.error) return { success: false, error: result.error.message || 'Failed to send email' };
    return { success: true, messageId: (result.data && result.data.id) || '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`

    case 'sendgrid':
      return `
async function sendInvoiceEmail(invoiceData, pdfBuffer) {
  try {
    var sgMail = require('@sendgrid/mail');
    var apiKey = resolveSecretKey('apiKey');
    if (!apiKey) return { success: false, error: 'SendGrid API key not configured' };
    sgMail.setApiKey(apiKey);
    var emailData = buildEmailData(invoiceData);
    if (!emailData.to) return { success: false, error: 'No customer email provided' };

    var msg = {
      to: emailData.to,
      from: emailData.from,
      subject: emailData.subject,
      html: emailData.body,
      attachments: [{
        content: pdfBuffer.toString('base64'),
        filename: (invoiceData.invoiceNumber || 'invoice') + '.pdf',
        type: 'application/pdf',
        disposition: 'attachment',
      }],
    };
    var result = await sgMail.send(msg);
    return { success: true, messageId: '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`

    case 'mailgun':
      return `
async function sendInvoiceEmail(invoiceData, pdfBuffer) {
  try {
    var Mailgun = require('mailgun.js');
    var formData = require('form-data');
    var apiKey = resolveSecretKey('apiKey');
    var domain = resolveSecretKey('domain');
    if (!apiKey) return { success: false, error: 'Mailgun API key not configured' };
    if (!domain) return { success: false, error: 'Mailgun domain not configured' };

    var mailgun = new Mailgun(formData);
    var mg = mailgun.client({ username: 'api', key: apiKey });
    var emailData = buildEmailData(invoiceData);
    if (!emailData.to) return { success: false, error: 'No customer email provided' };

    var msg = {
      from: emailData.from,
      to: [emailData.to],
      subject: emailData.subject,
      html: emailData.body,
      attachment: [{
        data: pdfBuffer,
        filename: (invoiceData.invoiceNumber || 'invoice') + '.pdf',
        contentType: 'application/pdf',
      }],
    };
    var result = await mg.messages.create(domain, msg);
    return { success: true, messageId: result.id || '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`

    case 'postmark':
      return `
async function sendInvoiceEmail(invoiceData, pdfBuffer) {
  try {
    var postmark = require('postmark');
    var serverToken = resolveSecretKey('serverToken');
    if (!serverToken) return { success: false, error: 'Postmark server token not configured' };
    var client = new postmark.ServerClient(serverToken);
    var emailData = buildEmailData(invoiceData);
    if (!emailData.to) return { success: false, error: 'No customer email provided' };

    var msg = {
      From: emailData.from,
      To: emailData.to,
      Subject: emailData.subject,
      HtmlBody: emailData.body,
      Attachments: [{
        Name: (invoiceData.invoiceNumber || 'invoice') + '.pdf',
        Content: pdfBuffer.toString('base64'),
        ContentType: 'application/pdf',
      }],
    };
    var result = await client.sendEmail(msg);
    return { success: true, messageId: result.MessageID || '' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}`

    case 'mailersend':
      return `
// Pulls "name" and "email" out of the RFC-5322-ish \`from\` string the
// builder assembles. Three shapes in the wild:
//   1. "Acme Billing <billing@acme.com>"  → name="Acme Billing",  email="billing@acme.com"
//   2. "billing@acme.com"                  → name="",             email="billing@acme.com"
//   3. ""                                   → {}, caller handles the fallback
// The old implementation used naive \`.replace()\` chains that produced
// \`name="billing@acme.com"\` in case (2) — MailerSend accepts that but the
// email then appears in the recipient's client with itself as the sender
// name, which is ugly. Kept as a pure helper (no fallbacks baked in) so
// the caller decides what to do when a field is missing.
function parseFromString(from) {
  var str = String(from || '').trim();
  if (!str) return { name: '', email: '' };
  var m = /^(.*)<([^<>]+)>\\s*$/.exec(str);
  if (m) {
    return { name: m[1].trim(), email: m[2].trim() };
  }
  return { name: '', email: str };
}

async function sendInvoiceEmail(invoiceData, pdfBuffer) {
  var invoiceNumber = invoiceData && invoiceData.invoiceNumber ? invoiceData.invoiceNumber : '(no number)';
  try {
    console.info('[invoice-email][mailersend] begin — invoice=' + invoiceNumber +
      ', recipient=' + (invoiceData && invoiceData.customerEmail ? invoiceData.customerEmail : '(empty)') +
      ', pdfBytes=' + (pdfBuffer && pdfBuffer.length ? pdfBuffer.length : 0));
    var apiKey = resolveSecretKey('apiKey');
    if (!apiKey) {
      console.error('[invoice-email][mailersend] skip — API key not configured (set \`apiKey\` secret or INVOICE_MAILERSEND_APIKEY env)');
      return { success: false, error: 'MailerSend API key not configured' };
    }
    var emailData = buildEmailData(invoiceData);
    if (!emailData.to) {
      console.error('[invoice-email][mailersend] skip — invoiceData.customerEmail is empty (order hydrating yielded no billing_email; set it on the order row or pass customerEmail in the generate payload)');
      return { success: false, error: 'No customer email provided' };
    }

    var MailerSend = require('mailersend').MailerSend;
    var EmailParams = require('mailersend').EmailParams;
    var Sender = require('mailersend').Sender;
    var Recipient = require('mailersend').Recipient;
    var Attachment = require('mailersend').Attachment;

    var mailerSend = new MailerSend({ apiKey: apiKey });

    var parsedFrom = parseFromString(emailData.from);
    if (!parsedFrom.email) {
      console.error('[invoice-email][mailersend] skip — from address is empty (set invoiceSettings.emailDelivery.fromEmail)');
      return { success: false, error: 'Sender email not configured' };
    }
    var sender = new Sender(parsedFrom.email, parsedFrom.name || parsedFrom.email);

    var attachment = new Attachment(
      pdfBuffer.toString('base64'),
      (invoiceData.invoiceNumber || 'invoice') + '.pdf',
      'attachment'
    );

    var emailParams = new EmailParams()
      .setFrom(sender)
      .setTo([new Recipient(emailData.to)])
      .setSubject(emailData.subject)
      .setHtml(emailData.body)
      .setAttachments([attachment]);

    console.info('[invoice-email][mailersend] sending — from=' + parsedFrom.email +
      ' (name="' + (parsedFrom.name || parsedFrom.email) + '")' +
      ', to=' + emailData.to + ', subject="' + emailData.subject + '"');

    var result = await mailerSend.email.send(emailParams);
    // MailerSend SDK v2 returns an Axios-style response; message-id lives
    // in the \`x-message-id\` response header (body is empty on 202). Code
    // defensively because shape varies between SDK minor versions.
    var messageId = '';
    if (result && result.headers) {
      messageId = result.headers['x-message-id'] || result.headers.get?.('x-message-id') || '';
    }
    console.info('[invoice-email][mailersend] success — invoice=' + invoiceNumber +
      ', messageId=' + (messageId || '(empty)') +
      ', status=' + (result && result.statusCode ? result.statusCode : 'unknown'));
    return { success: true, messageId: messageId };
  } catch (err) {
    // MailerSend throws on non-2xx, exposing \`body.errors\` (validation
    // failures like "unverified sender domain") on \`err.body\`. Surfacing
    // both the message and the body gives actionable detail for the three
    // most common failure modes: unverified sender, invalid API key, and
    // trial-account recipient restrictions.
    var errMsg = err && err.message ? err.message : String(err);
    var errBody = '';
    try { errBody = err && err.body ? JSON.stringify(err.body) : ''; } catch (_e) { errBody = ''; }
    console.error('[invoice-email][mailersend] FAILED — invoice=' + invoiceNumber + ', error=' + errMsg + (errBody ? ', body=' + errBody : ''));
    return { success: false, error: errMsg };
  }
}`

    default:
      return `
async function sendInvoiceEmail() {
  return { success: false, error: 'Unsupported email provider: ${provider}' };
}`
  }
}

export const getEmailProviderDependencies = (provider: string | null): Record<string, string> => {
  if (!provider) {
    return {}
  }
  switch (provider) {
    case 'resend':
      return { resend: '^4.0.0' }
    case 'sendgrid':
      return { '@sendgrid/mail': '^8.0.0' }
    case 'mailgun':
      return { 'mailgun.js': '^10.0.0', 'form-data': '^4.0.0' }
    case 'postmark':
      return { postmark: '^4.0.0' }
    case 'mailersend':
      return { mailersend: '^2.0.0' }
    default:
      return {}
  }
}
