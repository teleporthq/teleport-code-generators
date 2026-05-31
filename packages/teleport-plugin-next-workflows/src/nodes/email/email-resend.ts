import { NodeHandlerGenerator, handlerToString } from '../types'

async function email_resend(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const from = config.from
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
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: body,
    }

    if (replyTo) {
      payload.reply_to = replyTo
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
    return handlerToString(email_resend)
  },
}
