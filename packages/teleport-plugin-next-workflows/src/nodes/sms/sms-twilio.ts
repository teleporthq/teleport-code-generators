import { NodeHandlerGenerator, handlerToString } from '../types'

async function sms_twilio(config: any, context: Record<string, unknown>) {
  const accountSid = config.accountSid
  const authToken = config.authToken
  const from = config.from
  const to = config.to
  const message = config.message
  const messagingServiceSid = config.messagingServiceSid
  const statusCallback = config.statusCallback

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const twilio = __nodeRequire('twilio')
    const client = twilio(accountSid, authToken)

    const msgPayload: Record<string, any> = {
      body: message,
      to,
    }

    if (messagingServiceSid) {
      msgPayload.messagingServiceSid = messagingServiceSid
    } else {
      msgPayload.from = from
    }

    if (statusCallback) {
      msgPayload.statusCallback = statusCallback
    }

    const result = await client.messages.create(msgPayload)

    return { messageSid: result.sid || '', success: true, status: result.status || '' }
  } catch (err: unknown) {
    const error = err as any
    return { messageSid: '', success: false, error: error.message || 'Failed to send SMS' }
  }
}
export const smsTwilio: NodeHandlerGenerator = {
  nodeType: 'sms-twilio',
  executionEnv: 'server',
  dependencies: {
    twilio: '^5.0.0',
  },
  generateHandler(): string {
    return handlerToString(sms_twilio)
  },
}
