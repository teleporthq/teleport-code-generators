import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_join_channel(config: any, context: Record<string, unknown>) {
  const channelName = config.channelName
  if (!channelName) {
    return { success: false, error: 'channelName is required' }
  }

  const rt = typeof window !== 'undefined' ? (window as any).__teleportRealtime : null
  const userId = rt ? rt.getUserId() : 'anon'
  const userName = rt ? rt.getUserName() : 'Anonymous'
  const channelData = config.channelData || undefined
  let parsedChannelData
  if (channelData && typeof channelData === 'string') {
    try {
      parsedChannelData = JSON.parse(channelData)
    } catch (e) {
      parsedChannelData = undefined
    }
  } else if (channelData && typeof channelData === 'object') {
    parsedChannelData = channelData
  }

  try {
    const baseUrl = (context && (context as any).__baseUrl) || ''
    const joinRes = await fetch(baseUrl + '/api/realtime/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelName,
        userId,
        userName,
        userData: parsedChannelData,
      }),
    })
    const joinData = await joinRes.json()

    if (!joinRes.ok) {
      return {
        success: false,
        error: (joinData.error && joinData.error.message) || 'Failed to join channel',
        errorCode: joinData.error && joinData.error.code,
      }
    }

    if (rt) {
      const client = rt.initializeClient(joinData)
      if (client) {
        await rt.whenReady()
        const nsChannelName = rt.getNamespacedChannelName(channelName)
        const channel = client.channels.get(nsChannelName)
        await channel.attach()
        try {
          await channel.presence.enter({
            userId,
            userName,
            userData: parsedChannelData,
          })
        } catch (presErr: unknown) {
          /* presence enter may fail if capabilities don't include it */
        }
        rt.incrementChannelRef(nsChannelName)
      }
    }

    return {
      channelName,
      success: true,
      memberCount: joinData.memberCount || 0,
      namespace: joinData.namespace || '',
      timestamp: Date.now(),
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message || 'Failed to join channel' }
  }
}

export const realtimeJoinChannel: NodeHandlerGenerator = {
  nodeType: 'realtime-join-channel',
  executionEnv: 'client',
  dependencies: { ably: '^2.6.0' },
  generateHandler(): string {
    return handlerToString(realtime_join_channel)
  },
}
