import { NodeHandlerGenerator, handlerToString } from '../types'
import { assertHandlerHasNoModuleRefs } from '../analytics/commerce-tracking'
import { EMAIL_RECIPIENTS_HELPER_SOURCE, EmailDeliveriesPlan } from './email-recipients'

// Ambient, not imported: a serialized handler has no module scope, so
// generateHandler appends the recipients helper's source (beside this file).
declare function __emailRecipients(to: unknown): unknown[]
declare function __emailDeliveries(plan: EmailDeliveriesPlan): Promise<unknown>

async function email_mailersend(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const from = config.from
  const fromName = config.fromName || ''
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc
  const recipients = __emailRecipients(config.to)

  async function sendTo(to: any) {
    try {
      const __nodeRequire =
        typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
      const mailersendPkg = __nodeRequire('mailersend')
      const MailerSend = mailersendPkg.MailerSend
      const EmailParams = mailersendPkg.EmailParams
      const Sender = mailersendPkg.Sender
      const Recipient = mailersendPkg.Recipient

      const mailerSend = new MailerSend({ apiKey })
      const sentFrom = new Sender(from, fromName)

      const recipient =
        typeof to === 'object' && to.email
          ? new Recipient(to.email, to.name || '')
          : new Recipient(to, '')

      const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo([recipient])
        .setSubject(subject)
        .setHtml(body)

      if (replyTo) {
        emailParams.setReplyTo(new Sender(replyTo))
      }

      if (cc) {
        const ccList = Array.isArray(cc) ? cc : [cc]
        emailParams.setCc(
          ccList.map(function (email: any) {
            return new Recipient(typeof email === 'object' ? email.email : email, '')
          })
        )
      }

      if (bcc) {
        const bccList = Array.isArray(bcc) ? bcc : [bcc]
        emailParams.setBcc(
          bccList.map(function (email: any) {
            return new Recipient(typeof email === 'object' ? email.email : email, '')
          })
        )
      }

      const response = await mailerSend.email.send(emailParams)
      const statusCode = response && response.statusCode

      if (statusCode === 202 || statusCode === 200) {
        const messageId = (response.headers && response.headers['x-message-id']) || ''
        return { messageId, success: true }
      }

      return {
        messageId: '',
        success: false,
        error: (response.body && response.body.message) || 'Failed to send email',
      }
    } catch (err: unknown) {
      return { messageId: '', success: false, error: (err as Error).message }
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
export const emailMailersend: NodeHandlerGenerator = {
  nodeType: 'email-mailersend',
  executionEnv: 'server',
  dependencies: {
    mailersend: '^2.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_mailersend) + '\n' + EMAIL_RECIPIENTS_HELPER_SOURCE,
      'email-mailersend'
    )
  },
}
