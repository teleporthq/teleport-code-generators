import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from '../email/outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function sms_smsapi(config: any, context: Record<string, unknown>) {
  // Line breaks out of every header; a visitor-supplied recipient counted
  // (see outbound-message-guard).
  const refused = await __outboundMessageGuard('sms', config, context)
  if (refused) {
    // Over a limit: skipped, not failed, so the visitor's action goes on.
    return refused.skipped
      ? { messageId: '', skipped: true, reason: refused.skipped }
      : { messageId: '', success: false, error: refused.error }
  }
  const accessToken = config.accessToken
  const from = config.from
  const to = config.to
  const message = config.message

  try {
    const params = new URLSearchParams()
    params.append('from', from)
    params.append('to', to)
    params.append('message', message)
    params.append('format', 'json')

    const response = await fetch('https://api.smsapi.com/sms.do', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      return {
        messageId: '',
        success: false,
        error: (data.error && data.message) || 'Failed to send SMS',
      }
    }

    let msgId = ''
    if (data.list && data.list[0]) {
      msgId = data.list[0].id || ''
    }

    return { messageId: String(msgId), success: true }
  } catch (err: unknown) {
    return { messageId: '', success: false, error: (err as Error).message }
  }
}
export const smsSmsapi: NodeHandlerGenerator = {
  nodeType: 'sms-smsapi',
  executionEnv: 'server',
  ...outboundMessageHandlerSources(sms_smsapi),
}
