import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_discord(config: any, context: Record<string, unknown>) {
  // Safely parse a fetch response: providers (Dropbox, Stripe legacy errors,
  // Slack rate-limit pages, …) sometimes return plain text on failure.
  // We read once as text and only parse JSON when it actually parses.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const __readJson = async (resp: any): Promise<any> => {
    const text = await resp.text()
    if (!text) {
      return {}
    }
    try {
      return JSON.parse(text)
    } catch (e: unknown) {
      void e
      return { error_summary: text, error: text, message: text, raw: text }
    }
  }
  const token = config.token
  const action = config.action
  const baseUrl = 'https://discord.com/api/v10/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bot ' + token,
  }

  switch (action) {
    case 'send-message': {
      const body: Record<string, any> = {
        content: config.content || '',
        tts: config.tts || false,
      }
      if (config.embeds) {
        body.embeds = config.embeds
      }
      const response = await fetch(baseUrl + 'channels/' + config.channelId + '/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to send message' }
      }
      return { success: true, message: data }
    }
    case 'create-channel': {
      const response = await fetch(baseUrl + 'guilds/' + config.guildId + '/channels', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: config.name,
          type: config.type || 0,
          topic: config.topic || '',
          parent_id: config.parentId || null,
          nsfw: config.nsfw || false,
          position: config.position || null,
        }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create channel' }
      }
      return { success: true, channel: data }
    }
    case 'add-role': {
      const response = await fetch(
        baseUrl +
          'guilds/' +
          config.guildId +
          '/members/' +
          config.userId +
          '/roles/' +
          config.roleId,
        {
          method: 'PUT',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to add role' }
      }
      return { success: true }
    }
    case 'edit-message': {
      const body: Record<string, any> = { content: config.content || '' }
      if (config.embeds) {
        body.embeds = config.embeds
      }
      const response = await fetch(
        baseUrl + 'channels/' + config.channelId + '/messages/' + config.messageId,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to edit message' }
      }
      return { success: true, message: data }
    }
    case 'delete-message': {
      const response = await fetch(
        baseUrl + 'channels/' + config.channelId + '/messages/' + config.messageId,
        {
          method: 'DELETE',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to delete message' }
      }
      return { success: true }
    }
    case 'get-message': {
      const response = await fetch(
        baseUrl + 'channels/' + config.channelId + '/messages/' + config.messageId,
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get message' }
      }
      return { success: true, message: data }
    }
    case 'get-channel': {
      const response = await fetch(baseUrl + 'channels/' + config.channelId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get channel' }
      }
      return { success: true, channel: data }
    }
    case 'delete-channel': {
      const response = await fetch(baseUrl + 'channels/' + config.channelId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to delete channel' }
      }
      return { success: true }
    }
    case 'remove-role': {
      const response = await fetch(
        baseUrl +
          'guilds/' +
          config.guildId +
          '/members/' +
          config.userId +
          '/roles/' +
          config.roleId,
        {
          method: 'DELETE',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to remove role' }
      }
      return { success: true }
    }
    case 'ban-user': {
      const body: Record<string, any> = {}
      if (config.deleteMessageDays) {
        body.delete_message_days = config.deleteMessageDays
      }
      if (config.reason) {
        body.reason = config.reason
      }
      const response = await fetch(
        baseUrl + 'guilds/' + config.guildId + '/bans/' + config.userId,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(body),
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to ban user' }
      }
      return { success: true }
    }
    case 'unban-user': {
      const response = await fetch(
        baseUrl + 'guilds/' + config.guildId + '/bans/' + config.userId,
        {
          method: 'DELETE',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to unban user' }
      }
      return { success: true }
    }
    case 'kick-user': {
      const response = await fetch(
        baseUrl + 'guilds/' + config.guildId + '/members/' + config.userId,
        {
          method: 'DELETE',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to kick user' }
      }
      return { success: true }
    }
    case 'create-reaction': {
      if (!config.emoji) {
        return { success: false, error: 'emoji is required' }
      }
      const emoji = encodeURIComponent(config.emoji)
      const response = await fetch(
        baseUrl +
          'channels/' +
          config.channelId +
          '/messages/' +
          config.messageId +
          '/reactions/' +
          emoji +
          '/@me',
        {
          method: 'PUT',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to add reaction' }
      }
      return { success: true }
    }
    case 'get-guild': {
      const response = await fetch(baseUrl + 'guilds/' + config.guildId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get guild' }
      }
      return { success: true, guild: data }
    }
    case 'get-guild-members': {
      let url = baseUrl + 'guilds/' + config.guildId + '/members'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.after) {
        params.push('after=' + config.after)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (Array.isArray(data) ? null : data.message) || 'Failed to get guild members',
        }
      }
      return { success: true, members: data }
    }
    case 'create-thread': {
      const body: Record<string, any> = {
        name: config.name,
        type: config.type || 11,
      }
      if (config.messageId) {
        body.message_id = config.messageId
      }
      if (config.autoArchiveDuration) {
        body.auto_archive_duration = config.autoArchiveDuration
      }
      const response = await fetch(baseUrl + 'channels/' + config.channelId + '/threads', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create thread' }
      }
      return { success: true, channel: data }
    }
    case 'pin-message': {
      const response = await fetch(
        baseUrl + 'channels/' + config.channelId + '/pins/' + config.messageId,
        {
          method: 'PUT',
          headers,
        }
      )
      if (!response.ok) {
        let data: Record<string, any> = {}
        try {
          data = await __readJson(response)
        } catch (e) {}
        return { success: false, error: data.message || 'Failed to pin message' }
      }
      return { success: true }
    }
    case 'get-user': {
      const response = await fetch(baseUrl + 'users/' + config.userId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get user' }
      }
      return { success: true, user: data }
    }
    case 'list-channels': {
      const response = await fetch(baseUrl + 'guilds/' + config.guildId + '/channels', {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (Array.isArray(data) ? null : data.message) || 'Failed to list channels',
        }
      }
      return { success: true, channels: data }
    }
    default:
      throw new Error('Unknown integration-discord action: ' + action)
  }
}
export const integrationDiscord: IntegrationHandlerGenerator = {
  nodeType: 'integration-discord',
  executionEnv: 'server',
  secretFields: ['token'],
  generateHandler(): string {
    return handlerToString(integration_discord)
  },
}
