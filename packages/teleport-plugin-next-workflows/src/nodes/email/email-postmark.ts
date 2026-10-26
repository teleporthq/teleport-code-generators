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

async function email_postmark(config: any, context: Record<string, unknown>) {
  const serverToken = config.serverToken
  const from = config.from
  const fromName = config.fromName
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc
  const tag = config.tag
  const trackOpens = config.trackOpens
  const recipients = __emailRecipients(config.to)

  async function sendTo(to: unknown) {
    try {
      const __nodeRequire =
        typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
      const postmark = __nodeRequire('postmark')
      const client = new postmark.ServerClient(serverToken)

      const emailPayload: Record<string, any> = {
        From: __emailSender({ from, name: fromName }).header,
        To: to,
        Subject: subject,
        HtmlBody: body,
      }

      if (replyTo) {
        emailPayload.ReplyTo = replyTo
      }
      if (cc) {
        emailPayload.Cc = Array.isArray(cc) ? cc.join(', ') : cc
      }
      if (bcc) {
        emailPayload.Bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc
      }
      if (tag) {
        emailPayload.Tag = tag
      }
      if (trackOpens !== undefined) {
        emailPayload.TrackOpens = trackOpens
      }

      const result = await client.sendEmail(emailPayload)

      return { messageId: result.MessageID || '', success: true }
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
export const emailPostmark: NodeHandlerGenerator = {
  nodeType: 'email-postmark',
  executionEnv: 'server',
  dependencies: {
    postmark: '^4.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_postmark) +
        '\n' +
        EmailSender.generateEmailSenderHelperCode() +
        '\n' +
        EMAIL_RECIPIENTS_HELPER_SOURCE,
      'email-postmark'
    )
  },
}
