import { EmailSender } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'
import { assertHandlerHasNoModuleRefs } from '../analytics/commerce-tracking'

// Ambient, not imported: a serialized handler has no module scope, so
// generateHandler appends the helper's source (EmailSender, teleport-shared).
declare function __emailSender(sender: EmailSender.EmailSenderInput): EmailSender.EmailSenderParts

async function email_resend(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const from = config.from
  const fromName = config.fromName
  const to = config.to
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Resend = __nodeRequire('resend').Resend
    const resend = new Resend(apiKey)

    const payload: Record<string, any> = {
      from: __emailSender({ from, name: fromName }).header,
      to: Array.isArray(to) ? to : [to],
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
export const emailResend: NodeHandlerGenerator = {
  nodeType: 'email-resend',
  executionEnv: 'server',
  dependencies: {
    resend: '^4.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_resend) + '\n' + EmailSender.generateEmailSenderHelperCode(),
      'email-resend'
    )
  },
}
