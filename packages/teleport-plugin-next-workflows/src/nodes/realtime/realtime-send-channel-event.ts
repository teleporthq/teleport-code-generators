import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_send_channel_event(config: any, context: Record<string, unknown>) {
  const channelName = config.channelName
  const eventName = config.eventName
  const eventData = config.eventData || null
  const senderId = config.senderId || 'system'
  const senderName = config.senderName || 'System'

  if (!channelName) {
    return { success: false, error: 'channelName is required' }
  }
  if (!eventName) {
    return { success: false, error: 'eventName is required' }
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
      eventName,
      senderId,
      senderName,
    }

    if (eventData) {
      if (typeof eventData === 'string') {
        try {
          body.eventData = JSON.parse(eventData)
        } catch (e: unknown) {
          body.eventData = null
        }
      } else {
        body.eventData = eventData
      }
    }

    const response = await fetch(serverUrl + '/api/realtime/channels/event', {
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
        error: (result.error && result.error.message) || 'Failed to send event',
        errorCode: result.error && result.error.code,
      }
    }

    return {
      channelName,
      eventName,
      success: true,
      timestamp: result.timestamp || Date.now(),
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message || 'Failed to send event' }
  }
}

export const realtimeSendChannelEvent: NodeHandlerGenerator = {
  nodeType: 'realtime-send-channel-event',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(realtime_send_channel_event)
  },
}
