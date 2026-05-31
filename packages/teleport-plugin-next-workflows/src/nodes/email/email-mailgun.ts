import { NodeHandlerGenerator, handlerToString } from '../types'

async function email_mailgun(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const domain = config.domain
  const from = config.from
  const fromName = config.fromName || ''
  const to = config.to
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const Mailgun = __nodeRequire('mailgun.js')
    const FormData = __nodeRequire('form-data')
    const mailgun = new Mailgun(FormData)

    const clientOpts: Record<string, any> = { username: 'api', key: apiKey }
    if (config.region === 'eu') {
      clientOpts.url = 'https://api.eu.mailgun.net'
    }
    const mg = mailgun.client(clientOpts)

    const fromField = fromName ? fromName + ' <' + from + '>' : from
    const toField = Array.isArray(to) ? to : [to]

    const msgPayload: Record<string, any> = {
      from: fromField,
      to: toField,
      subject,
      html: body,
    }

    if (replyTo) {
      msgPayload['h:Reply-To'] = replyTo
    }
    if (cc) {
      msgPayload.cc = Array.isArray(cc) ? cc.join(', ') : cc
    }
    if (bcc) {
      msgPayload.bcc = Array.isArray(bcc) ? bcc.join(', ') : bcc
    }

    const result = await mg.messages.create(domain, msgPayload)

    return { messageId: result.id || '', success: true }
  } catch (err: unknown) {
    const error = err as any
    return { messageId: '', success: false, error: error.message || 'Failed to send email' }
  }
}
export const emailMailgun: NodeHandlerGenerator = {
  nodeType: 'email-mailgun',
  executionEnv: 'server',
  dependencies: {
    'mailgun.js': '^10.0.0',
    'form-data': '^4.0.0',
  },
  generateHandler(): string {
    return handlerToString(email_mailgun)
  },
}
