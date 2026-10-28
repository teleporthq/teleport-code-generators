import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from './outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function email_resend(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('email', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { id: '', skipped: true, reason: refused.skipped }
      : { id: '', success: false, error: refused.error }
  }
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
  ...outboundMessageHandlerSources(email_resend),
}
