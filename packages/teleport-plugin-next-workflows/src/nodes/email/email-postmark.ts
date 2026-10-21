import { EmailSender } from '@teleporthq/teleport-shared'
import { NodeHandlerGenerator, handlerToString } from '../types'
import { assertHandlerHasNoModuleRefs } from '../analytics/commerce-tracking'

// Ambient, not imported: a serialized handler has no module scope, so
// generateHandler appends the helper's source (EmailSender, teleport-shared).
declare function __emailSender(sender: EmailSender.EmailSenderInput): EmailSender.EmailSenderParts

async function email_postmark(config: any, context: Record<string, unknown>) {
  const serverToken = config.serverToken
  const from = config.from
  const fromName = config.fromName
  const to = config.to
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc
  const tag = config.tag
  const trackOpens = config.trackOpens

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const postmark = __nodeRequire('postmark')
    const client = new postmark.ServerClient(serverToken)

    const toField = Array.isArray(to) ? to.join(', ') : to

    const emailPayload: Record<string, any> = {
      From: __emailSender({ from, name: fromName }).header,
      To: toField,
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
export const emailPostmark: NodeHandlerGenerator = {
  nodeType: 'email-postmark',
  executionEnv: 'server',
  dependencies: {
    postmark: '^4.0.0',
  },
  generateHandler(): string {
    return assertHandlerHasNoModuleRefs(
      handlerToString(email_postmark) + '\n' + EmailSender.generateEmailSenderHelperCode(),
      'email-postmark'
    )
  },
}
