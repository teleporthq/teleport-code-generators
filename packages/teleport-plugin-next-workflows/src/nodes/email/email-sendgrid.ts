import { EmailSender } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'
import { assertHandlerHasNoModuleRefs } from '../analytics/commerce-tracking'
import { EMAIL_RECIPIENTS_HELPER_SOURCE, EmailDeliveriesPlan } from './email-recipients'

// Ambient, not imported: a serialized handler has no module scope, so
// generateHandler appends the helpers' source (EmailSender from teleport-shared,
// the recipients helper beside this file).
declare function __emailSender(sender: EmailSender.EmailSenderInput): EmailSender.EmailSenderParts
declare function __emailRecipients(to: unknown): unknown[]
declare function __emailDeliveries(plan: EmailDeliveriesPlan): Promise<unknown>

async function email_sendgrid(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const from = config.from
  const fromName = config.fromName
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
      const MailService = __nodeRequire('@sendgrid/mail').MailService
      const sgMail = new MailService()
      sgMail.setApiKey(apiKey)

      // SendGrid reads a "Name <email>" string's name verbatim, quotes included,
      // so a named sender goes as its two parts.
      const sender = __emailSender({ from, name: fromName })
      const msg: Record<string, any> = {
        to: [to],
        from: sender.name ? { email: sender.email, name: sender.name } : sender.email,
        subject,
        html: body,
      }

      if (replyTo) {
        msg.replyTo = replyTo
      }
      if (cc) {
        msg.cc = Array.isArray(cc) ? cc : [cc]
      }
      if (bcc) {
        msg.bcc = Array.isArray(bcc) ? bcc : [bcc]
      }

      const response = await sgMail.send(msg)
      const statusCode = response && response[0] && response[0].statusCode
      const messageId =
        (response && response[0] && response[0].headers && response[0].headers['x-message-id']) ||
        ''

      return { messageId, success: statusCode === 202 || statusCode === 200 }
    } catch (err: unknown) {
      const error = err as any
      let message = 'Failed to send email'
      if (error.response && error.response.body && error.response.body.errors) {
        message = error.response.body.errors
          .map(function (e: any) {
            return e.message
          })
          .join(', ')
      } else if (error.message) {
        message = error.message
      }
      return { messageId: '', success: false, error: message }
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
export const emailSendgrid: NodeHandlerGenerator = {
  nodeType: 'email-sendgrid',
  executionEnv: 'server',
  dependencies: {
    '@sendgrid/mail': '^8.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_sendgrid) +
        '\n' +
        EmailSender.generateEmailSenderHelperCode() +
        '\n' +
        EMAIL_RECIPIENTS_HELPER_SOURCE,
      'email-sendgrid'
    )
  },
}
