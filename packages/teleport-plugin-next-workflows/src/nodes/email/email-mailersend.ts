import { NodeHandlerGenerator, handlerToString } from '../types'

async function email_mailersend(config: any, context: Record<string, unknown>) {
  const apiKey = config.apiKey
  const from = config.from
  const fromName = config.fromName || ''
  const to = config.to
  const subject = config.subject
  const body = config.body
  const replyTo = config.replyTo
  const cc = config.cc
  const bcc = config.bcc

  try {
    const mailersendPkg = require('mailersend')
    const MailerSend = mailersendPkg.MailerSend
    const EmailParams = mailersendPkg.EmailParams
    const Sender = mailersendPkg.Sender
    const Recipient = mailersendPkg.Recipient

    const mailerSend = new MailerSend({ apiKey })
    const sentFrom = new Sender(from, fromName)

    const toList = Array.isArray(to) ? to : [to]
    const recipients = toList.map(function (email: any) {
      if (typeof email === 'object' && email.email) {
        return new Recipient(email.email, email.name || '')
      }
      return new Recipient(email, '')
    })

    const emailParams = new EmailParams()
      .setFrom(sentFrom)
      .setTo(recipients)
      .setSubject(subject)
      .setHtml(body)

    if (replyTo) {
      emailParams.setReplyTo(new Sender(replyTo))
    }

    if (cc) {
      const ccList = Array.isArray(cc) ? cc : [cc]
      emailParams.setCc(
        ccList.map(function (email: any) {
          return new Recipient(typeof email === 'object' ? email.email : email, '')
        })
      )
    }

    if (bcc) {
      const bccList = Array.isArray(bcc) ? bcc : [bcc]
      emailParams.setBcc(
        bccList.map(function (email: any) {
          return new Recipient(typeof email === 'object' ? email.email : email, '')
        })
      )
    }

    const response = await mailerSend.email.send(emailParams)
    const statusCode = response && response.statusCode

    if (statusCode === 202 || statusCode === 200) {
      const messageId = (response.headers && response.headers['x-message-id']) || ''
      return { messageId, success: true }
    }

    return {
      messageId: '',
      success: false,
      error: (response.body && response.body.message) || 'Failed to send email',
    }
  } catch (err: unknown) {
    return { messageId: '', success: false, error: (err as Error).message }
  }
}
export const emailMailersend: NodeHandlerGenerator = {
  nodeType: 'email-mailersend',
  executionEnv: 'server',
  dependencies: {
    mailersend: '^2.0.0',
  },
  generateHandler(): string {
    return handlerToString(email_mailersend)
  },
}
