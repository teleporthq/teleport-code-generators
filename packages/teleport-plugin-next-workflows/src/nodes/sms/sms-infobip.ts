import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from '../email/outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function sms_infobip(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('sms', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { messageId: '', skipped: true, reason: refused.skipped }
      : { messageId: '', success: false, error: refused.error }
  }
  const apiKey = config.apiKey
  // Infobip's dashboard gives the base URL WITH the scheme (https://xxx.api.infobip.com).
  // Strip any existing scheme so we don't build the invalid `https://https://...`.
  const baseUrl = String(config.baseUrl || '').replace(/^https?:\/\//, '')
  const from = config.from
  const to = config.to
  const message = config.message

  try {
    const destinations = Array.isArray(to)
      ? to.map(function (phone) {
          return { to: phone }
        })
      : [{ to }]

    const response = await fetch('https://' + baseUrl + '/sms/2/text/advanced', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'App ' + apiKey,
      },
      body: JSON.stringify({
        messages: [
          {
            from,
            destinations,
            text: message,
          },
        ],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return {
        messageId: '',
        success: false,
        error:
          (data.requestError &&
            data.requestError.serviceException &&
            data.requestError.serviceException.text) ||
          'Failed to send SMS',
      }
    }

    let msgId = ''
    if (data.messages && data.messages[0]) {
      msgId = data.messages[0].messageId || ''
    }

    return { messageId: msgId, success: true }
  } catch (err: unknown) {
    return { messageId: '', success: false, error: (err as Error).message }
  }
}
export const smsInfobip: NodeHandlerGenerator = {
  nodeType: 'sms-infobip',
  executionEnv: 'server',
  ...outboundMessageHandlerSources(sms_infobip),
}
