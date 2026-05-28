import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_list_channels(config: any, context: Record<string, unknown>) {
  const rt = typeof window !== 'undefined' ? (window as any).__teleportRealtime : null
  const filterByUser = config.filterByUser === true
  const userId = rt ? rt.getUserId() : undefined

  try {
    const body: Record<string, unknown> = {}
    if (filterByUser) {
      body.filterByUser = true
      body.userId = userId
    }

    const baseUrl = (context && (context as any).__baseUrl) || ''
    const response = await fetch(baseUrl + '/api/realtime/channels/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()

    if (!response.ok) {
      return {
        channels: [],
        channelCount: 0,
        error: (data.error && data.error.message) || 'Failed to list channels',
      }
    }

    return {
      channels: data.channels || [],
      channelCount: data.channelCount || (data.channels ? data.channels.length : 0),
    }
  } catch (err: unknown) {
    return { channels: [], channelCount: 0, error: (err as Error).message }
  }
}

export const realtimeListChannels: NodeHandlerGenerator = {
  nodeType: 'realtime-list-channels',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(realtime_list_channels)
  },
}
