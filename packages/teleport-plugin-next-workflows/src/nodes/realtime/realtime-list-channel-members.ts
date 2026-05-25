import { NodeHandlerGenerator, handlerToString } from '../types'

async function realtime_list_channel_members(config: any, context: Record<string, unknown>) {
  const channelName = config.channelName
  if (!channelName) {
    return { channelName: '', members: [], memberCount: 0, error: 'channelName is required' }
  }

  try {
    const baseUrl = (context && (context as any).__baseUrl) || ''
    const response = await fetch(baseUrl + '/api/realtime/channels/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelName }),
    })
    const data = await response.json()

    if (!response.ok) {
      return {
        channelName,
        members: [],
        memberCount: 0,
        error: (data.error && data.error.message) || 'Failed to list members',
      }
    }

    return {
      channelName,
      members: data.members || [],
      memberCount: data.memberCount || (data.members ? data.members.length : 0),
    }
  } catch (err: unknown) {
    return { channelName, members: [], memberCount: 0, error: (err as Error).message }
  }
}

export const realtimeListChannelMembers: NodeHandlerGenerator = {
  nodeType: 'realtime-list-channel-members',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(realtime_list_channel_members)
  },
}
