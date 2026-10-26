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

async function email_resend(config: any, context: Record<string, unknown>) {
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
      const Resend = __nodeRequire('resend').Resend
      const resend = new Resend(apiKey)

      const payload: Record<string, any> = {
        from: __emailSender({ from, name: fromName }).header,
        to: [to],
        subject,
        html: body,
      }

      if (replyTo) {
        // Resend SDK input uses the camelCase `replyTo` key (it maps to the
        // on-the-wire `reply_to` internally); a snake_case key is silently dropped.
        payload.replyTo = replyTo
      }
      if (cc) {
        payload.cc = Array.isArray(cc) ? cc : [cc]
      }
      if (bcc) {
        payload.bcc = Array.isArray(bcc) ? bcc : [bcc]
      }

      const data = await resend.emails.send(payload)

      if (data.error) {
        return { id: '', success: false, error: data.error.message || 'Failed to send email' }
      }

      return { id: (data.data && data.data.id) || '', success: true }
    } catch (err: unknown) {
      return { id: '', success: false, error: (err as Error).message }
    }
  }

  if (recipients.length === 0) {
    return { id: '', success: false, error: 'No recipient' }
  }
  if (recipients.length === 1) {
    return sendTo(recipients[0])
  }
  return __emailDeliveries({ recipients, send: sendTo, idKey: 'id' })
}
export const emailResend: NodeHandlerGenerator = {
  nodeType: 'email-resend',
  executionEnv: 'server',
  dependencies: {
    resend: '^4.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_resend) +
        '\n' +
        EmailSender.generateEmailSenderHelperCode() +
        '\n' +
        EMAIL_RECIPIENTS_HELPER_SOURCE,
      'email-resend'
    )
  },
}
