import { NodeHandlerGenerator } from '../types'
import { outboundMessageHandlerSources } from '../email/outbound-message-guard'

declare function __outboundMessageGuard(channel: string, config: any, context: any): Promise<any>

async function sms_textmagic(config: any, context: Record<string, unknown>) {
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
  const username = config.username
  const from = config.from
  const to = config.to
  const message = config.message

  try {
    const toField = Array.isArray(to) ? to.join(',') : to

    const response = await fetch('https://rest.textmagic.com/api/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TM-Username': username,
        'X-TM-Key': apiKey,
      },
      body: JSON.stringify({
        text: message,
        phones: toField,
        from,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return { messageId: '', success: false, error: data.message || 'Failed to send SMS' }
    }

    return { messageId: String(data.id || ''), success: true }
  } catch (err: unknown) {
    return { messageId: '', success: false, error: (err as Error).message }
  }
}
export const smsTextmagic: NodeHandlerGenerator = {
  nodeType: 'sms-textmagic',
  executionEnv: 'server',
  ...outboundMessageHandlerSources(sms_textmagic),
}
