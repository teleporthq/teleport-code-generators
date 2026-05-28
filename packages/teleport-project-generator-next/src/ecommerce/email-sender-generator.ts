// Shared email-sender module for the generated Next.js project.
//
// Why this exists: order-notification and low-stock-alert API routes
// both render `{{token}}` templates and dispatch to one of several
// providers (Postmark / SendGrid / Resend / SMTP fallback). Without a
// shared helper each endpoint duplicates the provider switch + retry
// + logging, which led to drift the last time we touched it (postmark
// wasn't supported in order-notification, sendgrid wasn't supported
// in low-stock, etc.). One helper means one place to fix.
//
// Emits `utils/ecommerce/email-sender.js` as plain CommonJS so the
// API routes (which are `pages/api/**` and use mixed import styles)
// can `require()` it without a TypeScript transpile step. The
// generated file is otherwise self-contained — no React, no Next
// runtime — and safe to import from any server-side context
// (workflow server segments, webhooks, the data-api itself).

import { UIDLEcommerceSettings } from '@teleporthq/teleport-types'

const POSTMARK_PROVIDER = 'postmark'
const SENDGRID_PROVIDER = 'sendgrid'
const RESEND_PROVIDER = 'resend'

// Render `{{token}}` placeholders against a flat payload of values.
// The regex matches `{{ word }}` (whitespace-tolerant, word chars only)
// so surrounding HTML markup that contains lone `{` / `}` is left
// untouched. Missing tokens render as empty string — never as the
// literal `{{token}}`, which would leak the template into the email.
const RENDER_TEMPLATE_FN = `function renderTemplate(template, payload) {
  if (!template) return ''
  return String(template).replace(/\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}/g, function(_match, key) {
    var v = payload && payload[key]
    if (v == null) return ''
    return String(v)
  })
}`

// Strip every HTML tag for the plain-text fallback. Mail clients that
// can't render HTML (and most spam-score heuristics) need a parallel
// text body — this is the cheapest way to derive one from the HTML
// template the merchant authored in the GUI.
const HTML_TO_TEXT_FN = `function htmlToText(html) {
  if (!html) return ''
  return String(html).replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim()
}`

// Build the provider-specific `dispatch(payload)` function for the
// generated email-sender module. Each provider returns a Promise
// that resolves on success and rejects on dispatch failure.
//
// We deliberately use the providers' HTTPS REST APIs (rather than
// their npm SDKs) for everything except SendGrid + Resend — both of
// those SDKs are tiny, already in our dependency tree elsewhere, and
// give better error messages than raw HTTP would. Postmark + the
// SMTP fallback go via fetch / nodemailer to avoid an extra
// dependency just to send one email.
const buildProviderDispatch = (provider: string | null | undefined): string => {
  switch (provider) {
    case SENDGRID_PROVIDER:
      return `var sgMail = require('@sendgrid/mail')
sgMail.setApiKey(process.env.SENDGRID_API_KEY || '')
function dispatchProviderEmail(envelope) {
  var msg = {
    to: envelope.to,
    from: envelope.fromDisplay,
    subject: envelope.subject,
    html: envelope.html,
    text: envelope.text,
  }
  if (envelope.replyTo) msg.replyTo = envelope.replyTo
  return sgMail.send(msg)
}`

    case RESEND_PROVIDER:
      return `var Resend = require('resend').Resend
var resend = new Resend(process.env.RESEND_API_KEY || '')
function dispatchProviderEmail(envelope) {
  var payload = {
    from: envelope.fromDisplay,
    to: envelope.to,
    subject: envelope.subject,
    html: envelope.html,
    text: envelope.text,
  }
  if (envelope.replyTo) payload.reply_to = envelope.replyTo
  return resend.emails.send(payload)
}`

    case POSTMARK_PROVIDER:
      // Postmark exposes a simple HTTPS endpoint that we hit
      // directly via fetch. The Sender Signature for `From` must
      // already be verified in the Postmark dashboard — Postmark
      // returns a 422 with ErrorCode 405 otherwise and our caller
      // surfaces that as a 500.
      return `if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = require('node-fetch')
}
function dispatchProviderEmail(envelope) {
  // Accept the modern, documented env var first; then a couple of
  // legacy aliases the GUI used to write into .env before this
  // generator existed. Keeps existing projects working without a
  // manual rename on the next regeneration.
  var token =
    process.env.POSTMARK_SERVER_TOKEN ||
    process.env.POSTMARK_API_TOKEN ||
    process.env.EMAIL_POSTMARK_SERVERTOKEN ||
    process.env.EMAIL_POSTMARK_SERVER_TOKEN ||
    ''
  if (!token) {
    return Promise.reject(new Error('POSTMARK_SERVER_TOKEN env var is not set'))
  }
  var payload = {
    From: envelope.fromDisplay,
    To: Array.isArray(envelope.to) ? envelope.to.join(',') : envelope.to,
    Subject: envelope.subject,
    HtmlBody: envelope.html,
    TextBody: envelope.text,
    MessageStream: process.env.POSTMARK_MESSAGE_STREAM || 'outbound',
  }
  if (envelope.replyTo) payload.ReplyTo = envelope.replyTo
  return fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': token,
    },
    body: JSON.stringify(payload),
  }).then(function(res) {
    if (res.ok) return res.json().catch(function() { return {} })
    return res.text().catch(function() { return '' }).then(function(t) {
      throw new Error('Postmark API error ' + res.status + ': ' + t)
    })
  })
}`

    default:
      // SMTP fallback. Covers the merchant who picked an unknown
      // provider name in the GUI (e.g. mailgun, mailersend) — they
      // still get a working pipeline as long as the SMTP_* env vars
      // are populated.
      return `var nodemailer = require('nodemailer')
function dispatchProviderEmail(envelope) {
  var transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: String(process.env.SMTP_SECURE || '') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  })
  var msg = {
    from: envelope.fromDisplay,
    to: envelope.to,
    subject: envelope.subject,
    html: envelope.html,
    text: envelope.text,
  }
  if (envelope.replyTo) msg.replyTo = envelope.replyTo
  return transporter.sendMail(msg)
}`
  }
}

interface EmailSenderOptions {
  provider: string | null
  fromEmail: string
  fromName: string
  replyTo: string
  // Tag included in every diagnostic log line so the dev console
  // shows which generator emitted this module (helps when both
  // order + low-stock end up in the same dev terminal).
  logTag?: string
}

// The two consumer modules (order-notification, low-stock-alert)
// call `sendNotificationEmail` with a fully-built envelope. The
// envelope carries the per-call recipient list + subject + html
// body; provider, from-display, reply-to are baked in at codegen
// time from the matching `UIDLEcommerce*Config`.
const buildSenderFunction = (opts: EmailSenderOptions): string => {
  const fromEmail = opts.fromEmail || ''
  const fromName = opts.fromName || ''
  const replyTo = opts.replyTo || ''
  const tag = opts.logTag || 'email'
  return `function sendNotificationEmail(recipients, subject, html) {
  var to = (recipients || []).filter(function(r) { return typeof r === 'string' && r.length > 0 })
  if (to.length === 0) {
    console.log('[${tag}] skipped: no recipients configured')
    return Promise.resolve({ sent: false, reason: 'no_recipients' })
  }
  var fromAddress = ${JSON.stringify(
    fromEmail
  )} || process.env.ORDER_NOTIFICATION_FROM_EMAIL || 'noreply@example.com'
  var fromName = ${JSON.stringify(fromName)}
  var fromDisplay = fromName ? (fromName + ' <' + fromAddress + '>') : fromAddress
  var replyTo = ${JSON.stringify(replyTo)}
  var text = htmlToText(html)
  var envelope = {
    to: to,
    fromDisplay: fromDisplay,
    subject: subject || '',
    html: html || '',
    text: text,
  }
  if (replyTo) envelope.replyTo = replyTo
  console.log('[${tag}] dispatching to ' + to.join(', ') + ' (subject="' + envelope.subject + '")')
  return dispatchProviderEmail(envelope)
    .then(function(result) {
      console.log('[${tag}] sent successfully')
      return { sent: true, recipients: to, providerResponse: result }
    })
    .catch(function(err) {
      console.error('[${tag}] dispatch failed: ' + (err && err.message ? err.message : String(err)))
      throw err
    })
}`
}

export const generateEmailSenderModule = (
  settings: UIDLEcommerceSettings,
  options: { logTag?: string } = {}
): string => {
  // The order-notification config drives the provider choice for
  // the module: both flows share one sender, so they share one
  // provider. If a merchant wants a different provider for
  // low-stock alerts they can configure it via the GUI today —
  // but the generated module today honours the order-notification
  // provider for both. This matches the typical real-world setup
  // (one transactional email provider per project) and keeps the
  // generated code small.
  const provider =
    settings.orderNotificationConfig?.provider ||
    settings.stockManagementConfig?.lowStockAlertConfig?.provider ||
    null
  const fromEmail =
    settings.orderNotificationConfig?.fromEmail ||
    settings.stockManagementConfig?.lowStockAlertConfig?.fromEmail ||
    ''
  const fromName =
    settings.orderNotificationConfig?.fromName ||
    settings.stockManagementConfig?.lowStockAlertConfig?.fromName ||
    ''
  const replyTo =
    settings.orderNotificationConfig?.replyTo ||
    settings.stockManagementConfig?.lowStockAlertConfig?.replyTo ||
    ''

  const providerDispatch = buildProviderDispatch(provider)
  const senderFn = buildSenderFunction({
    provider,
    fromEmail,
    fromName,
    replyTo,
    logTag: options.logTag,
  })

  return `// Auto-generated shared email sender.
// Consumed by /api/ecommerce/order-notification and
// /api/ecommerce/low-stock-alert. Edit the generator at
// teleport-project-generator-next/src/ecommerce/email-sender-generator.ts
// instead of this file — it will be overwritten on the next build.

${providerDispatch}

${RENDER_TEMPLATE_FN}

${HTML_TO_TEXT_FN}

${senderFn}

module.exports = {
  sendNotificationEmail: sendNotificationEmail,
  renderTemplate: renderTemplate,
}
`
}
