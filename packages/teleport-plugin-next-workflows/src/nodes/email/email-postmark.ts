import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from './outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function email_postmark(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('email', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { messageId: '', skipped: true, reason: refused.skipped }
      : { messageId: '', success: false, error: refused.error }
  }
  const serverToken = config.serverToken
  const from = config.from
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
      From: from,
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
  ...outboundMessageHandlerSources(email_postmark),
}
