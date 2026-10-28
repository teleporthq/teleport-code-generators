import { EmailSender } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from './outbound-message-guard'
import { EMAIL_RECIPIENTS_HELPER_SOURCE, EmailDeliveriesPlan } from './email-recipients'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>
// Ambient, not imported: a serialized handler has no module scope, so
// generateHandler appends the helpers' source (EmailSender from teleport-shared,
// the recipients helper beside this file).
declare function __emailSender(sender: EmailSender.EmailSenderInput): EmailSender.EmailSenderParts
declare function __emailRecipients(to: unknown): unknown[]
declare function __emailDeliveries(plan: EmailDeliveriesPlan): Promise<unknown>

async function email_mailgun(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('email', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { messageId: '', skipped: true, reason: refused.skipped }
      : { messageId: '', success: false, error: refused.error }
  }
  const apiKey = config.apiKey
  const domain = config.domain
  const from = config.from
  const fromName = config.fromName || ''
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc
  const recipients = __emailRecipients(config.to)

  async function sendTo(to: unknown) {
    try {
      const __nodeRequire =
        typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
      const Mailgun = __nodeRequire('mailgun.js')
      const FormData = __nodeRequire('form-data')
      const mailgun = new Mailgun(FormData)

      const clientOpts: Record<string, any> = { username: 'api', key: apiKey }
      if (config.region === 'eu') {
        clientOpts.url = 'https://api.eu.mailgun.net'
      }
      const mg = mailgun.client(clientOpts)

      const msgPayload: Record<string, any> = {
        from: __emailSender({ from, name: fromName }).header,
        to: [to],
        subject,
        html: body,
      }

      if (replyTo) {
        msgPayload['h:Reply-To'] = replyTo
      }
      if (cc) {
        msgPayload.cc = Array.isArray(cc) ? cc.join(', ') : cc
      }
      if (bcc) {
        msgPayload.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc
      }

      const result = await mg.messages.create(domain, msgPayload)

      return { messageId: result.id || '', success: true }
    } catch (err: unknown) {
      const error = err as any
      return { messageId: '', success: false, error: error.message || 'Failed to send email' }
    }
  }

  if (recipients.length === 0) {
    return { messageId: '', success: false, error: 'No recipient' }
  }
  if (recipients.length === 1) {
    return sendTo(recipients[0])
  }
  return __emailDeliveries({ recipients, send: sendTo, idKey: 'messageId' })
}
export const emailMailgun: NodeHandlerGenerator = {
  nodeType: 'email-mailgun',
  executionEnv: 'server',
  dependencies: {
    'mailgun.js': '^10.0.0',
    'form-data': '^4.0.0',
  },
  ...outboundMessageHandlerSources(email_mailgun, {
    nodeType: 'email-mailgun',
    extraSource:
      EmailSender.generateEmailSenderHelperCode() + '\n' + EMAIL_RECIPIENTS_HELPER_SOURCE,
  }),
}
