import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from './outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function email_sendgrid(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('email', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { messageId: '', skipped: true, reason: refused.skipped }
      : { messageId: '', success: false, error: refused.error }
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
    const MailService = __nodeRequire('@sendgrid/mail').MailService
    const sgMail = new MailService()
    sgMail.setApiKey(apiKey)

    const msg: Record<string, any> = {
      to: Array.isArray(to) ? to : [to],
      from,
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
      (response && response[0] && response[0].headers && response[0].headers['x-message-id']) || ''

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
export const emailSendgrid: NodeHandlerGenerator = {
  nodeType: 'email-sendgrid',
  executionEnv: 'server',
  dependencies: {
    '@sendgrid/mail': '^8.0.0',
  },
  ...outboundMessageHandlerSources(email_sendgrid),
}
