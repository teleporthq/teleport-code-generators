import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_leave_channel(config: any, context: Record<string, unknown>) {
  const channelName = config.channelName
  if (!channelName) {
    return { success: false, error: 'channelName is required' }
  }

  const rt = typeof window !== 'undefined' ? (window as any).__teleportRealtime : null
  const userId = rt ? rt.getUserId() : 'anon'

  try {
    const baseUrl = (context && (context as any).__baseUrl) || ''
    const leaveRes = await fetch(baseUrl + '/api/realtime/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName, userId }),
    })
    const leaveData = await leaveRes.json()
    const serverError = !leaveRes.ok
      ? (leaveData.error && leaveData.error.message) || 'Server leave failed'
      : null

    if (rt) {
      await rt.whenReady()
      const client = rt.getAblyClient()
      if (client) {
        const nsChannelName = rt.getNamespacedChannelName(channelName)
        const channel = client.channels.get(nsChannelName)

        try {
          await channel.presence.leave()
        } catch (e: unknown) {
          /* ignore */
        }

        const remaining = rt.decrementChannelRef(nsChannelName)
        if (remaining === 0) {
          await channel.detach()
        }
      }
    }

    return {
      channelName,
      success: !serverError,
      serverError: serverError || undefined,
      timestamp: Date.now(),
    }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message || 'Failed to leave channel' }
  }
}

export const realtimeLeaveChannel: NodeHandlerGenerator = {
  nodeType: 'realtime-leave-channel',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(realtime_leave_channel)
  },
}
