import { NodeHandlerGenerator, handlerToString } from '../types'

async function email_postmark(config: any, context: Record<string, unknown>) {
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
    const postmark = require('postmark')
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
  generateHandler(): string {
    return handlerToString(email_postmark)
  },
}
