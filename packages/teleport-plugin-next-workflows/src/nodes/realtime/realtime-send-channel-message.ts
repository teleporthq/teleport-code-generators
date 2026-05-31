import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_send_channel_message(config: any, context: Record<string, unknown>) {
  const channelName = config.channelName
  const message = config.message != null ? String(config.message) : ''
  const messageData = config.messageData || null
  const senderId = config.senderId || 'system'
  const senderName = config.senderName || 'System'

  if (!channelName) {
    return { success: false, error: 'channelName is required' }
  }

  try {
    const __env = (globalThis as any).process && (globalThis as any).process.env
    const serverUrl = __env ? __env.REALTIME_SERVER_URL : ''
    const apiKey = __env ? __env.REALTIME_SERVER_API_KEY : ''

    if (!serverUrl || !apiKey) {
      return {
        success: false,
        error:
          'Realtime server not configured (missing REALTIME_SERVER_URL or REALTIME_SERVER_API_KEY)',
      }
    }

    const body: Record<string, unknown> = {
      channelName,
      message,
      senderId,
      senderName,
    }

    if (messageData) {
      if (typeof messageData === 'string') {
        try {
          body.messageData = JSON.parse(messageData)
        } catch (e: unknown) {
          body.messageData = null
        }
      } else {
        body.messageData = messageData
      }
    }

    const response = await fetch(serverUrl + '/api/realtime/channels/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    })

    const result = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: (result.error && result.error.message) || 'Failed to send message',
        errorCode: result.error && result.error.code,
      }
    }

    return {
      channelName,
      success: true,
      messageId: result.messageId || '',
      timestamp: result.timestamp || Date.now(),
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message || 'Failed to send message' }
  }
}

export const realtimeSendChannelMessage: NodeHandlerGenerator = {
  nodeType: 'realtime-send-channel-message',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(realtime_send_channel_message)
  },
}
