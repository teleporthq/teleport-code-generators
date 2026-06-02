import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_slack(config: any, context: Record<string, unknown>) {
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
  const baseUrl = 'https://slack.com/api/'
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: 'Bearer ' + token,
  }

  switch (action) {
    case 'send-message': {
      const body: Record<string, any> = {
        channel: config.channel,
        text: config.text,
      }
      if (config.blocks) {
        body.blocks = config.blocks
      }
      if (config.threadTs) {
        body.thread_ts = config.threadTs
      }
      if (config.unfurlLinks !== undefined) {
        body.unfurl_links = config.unfurlLinks
      }
      if (config.unfurlMedia !== undefined) {
        body.unfurl_media = config.unfurlMedia
      }
      if (config.mrkdwn !== undefined) {
        body.mrkdwn = config.mrkdwn
      }
      const response = await fetch(baseUrl + 'chat.postMessage', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to send message' }
      }
      return { success: true, message: data.message, channel: data.channel, ts: data.ts }
    }
    case 'create-channel': {
      const body: Record<string, any> = { name: config.name }
      if (config.isPrivate) {
        body.is_private = config.isPrivate
      }
      if (config.teamId) {
        body.team_id = config.teamId
      }
      const response = await fetch(baseUrl + 'conversations.create', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to create channel' }
      }
      return { success: true, channel: data.channel }
    }
    case 'list-channels': {
      let url = baseUrl + 'conversations.list'
      const params = []
      if (config.types) {
        params.push('types=' + encodeURIComponent(config.types))
      }
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.cursor) {
        params.push('cursor=' + config.cursor)
      }
      if (config.excludeArchived) {
        params.push('exclude_archived=true')
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to list channels' }
      }
      return {
        success: true,
        channels: data.channels || [],
        responseMetadata: data.response_metadata,
      }
    }
    case 'update-message': {
      const body: Record<string, any> = {
        channel: config.channel,
        ts: config.ts,
        text: config.text,
      }
      if (config.blocks) {
        body.blocks = config.blocks
      }
      const response = await fetch(baseUrl + 'chat.update', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to update message' }
      }
      return { success: true, message: data.message }
    }
    case 'delete-message': {
      const response = await fetch(baseUrl + 'chat.delete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, ts: config.ts }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to delete message' }
      }
      return { success: true }
    }
    case 'archive-channel': {
      const response = await fetch(baseUrl + 'conversations.archive', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to archive channel' }
      }
      return { success: true }
    }
    case 'unarchive-channel': {
      const response = await fetch(baseUrl + 'conversations.unarchive', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to unarchive channel' }
      }
      return { success: true }
    }
    case 'rename-channel': {
      const response = await fetch(baseUrl + 'conversations.rename', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, name: config.name }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to rename channel' }
      }
      return { success: true, channel: data.channel }
    }
    case 'invite-to-channel': {
      const response = await fetch(baseUrl + 'conversations.invite', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, users: config.users || config.userId }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to invite to channel' }
      }
      return { success: true, channel: data.channel }
    }
    case 'kick-from-channel': {
      // Schema canonical name is `user`; older workflows used `userId`. Accept either.
      const slackUser = config.user || config.userId
      const response = await fetch(baseUrl + 'conversations.kick', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, user: slackUser }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to kick from channel' }
      }
      return { success: true }
    }
    case 'get-channel-info': {
      const url = baseUrl + 'conversations.info?channel=' + config.channel
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to get channel info' }
      }
      return { success: true, channel: data.channel }
    }
    case 'upload-file': {
      // files.upload does NOT accept a JSON body — it requires form-encoded
      // parameters. Sending JSON returns ok:false / no_file_data_provided.
      const form = new URLSearchParams()
      if (config.channel) {
        form.append('channels', config.channel)
      }
      if (config.content != null) {
        form.append('content', String(config.content))
      }
      if (config.filename) {
        form.append('filename', config.filename)
      }
      if (config.threadTs) {
        form.append('thread_ts', config.threadTs)
      }
      if (config.title) {
        form.append('title', config.title)
      }
      const response = await fetch(baseUrl + 'files.upload', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to upload file' }
      }
      return { success: true, file: data.file }
    }
    case 'add-reaction': {
      const response = await fetch(baseUrl + 'reactions.add', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, timestamp: config.ts, name: config.emoji }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to add reaction' }
      }
      return { success: true }
    }
    case 'remove-reaction': {
      const response = await fetch(baseUrl + 'reactions.remove', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, timestamp: config.ts, name: config.emoji }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to remove reaction' }
      }
      return { success: true }
    }
    case 'pin-message': {
      const response = await fetch(baseUrl + 'pins.add', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, timestamp: config.ts }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to pin message' }
      }
      return { success: true }
    }
    case 'unpin-message': {
      const response = await fetch(baseUrl + 'pins.remove', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, timestamp: config.ts }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to unpin message' }
      }
      return { success: true }
    }
    case 'set-channel-topic': {
      const response = await fetch(baseUrl + 'conversations.setTopic', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, topic: config.topic }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to set topic' }
      }
      return { success: true }
    }
    case 'set-channel-purpose': {
      const response = await fetch(baseUrl + 'conversations.setPurpose', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: config.channel, purpose: config.purpose }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to set purpose' }
      }
      return { success: true }
    }
    case 'get-user-info': {
      // Schema canonical name is `user`; older workflows used `userId`. Accept either.
      const slackUser = config.user || config.userId
      const url = baseUrl + 'users.info?user=' + slackUser
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to get user info' }
      }
      return { success: true, user: data.user }
    }
    case 'list-users': {
      let url = baseUrl + 'users.list'
      const params = []
      if (config.limit) {
        params.push('limit=' + config.limit)
      }
      if (config.cursor) {
        params.push('cursor=' + config.cursor)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to list users' }
      }
      return {
        success: true,
        members: data.members || [],
        responseMetadata: data.response_metadata,
      }
    }
    case 'set-user-status': {
      const response = await fetch(baseUrl + 'users.profile.set', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          profile: { status_text: config.statusText || '', status_emoji: config.statusEmoji || '' },
        }),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to set status' }
      }
      return { success: true }
    }
    case 'schedule-message': {
      const body: Record<string, any> = {
        channel: config.channel,
        text: config.text,
        post_at: config.postAt || Math.floor(Date.now() / 1000) + 60,
      }
      if (config.blocks) {
        body.blocks = config.blocks
      }
      const response = await fetch(baseUrl + 'chat.scheduleMessage', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!data.ok) {
        return { success: false, error: data.error || 'Failed to schedule message' }
      }
      return { success: true, scheduledMessageId: data.scheduled_message_id }
    }
    default:
      throw new Error('Unknown integration-slack action: ' + action)
  }
}
export const integrationSlack: IntegrationHandlerGenerator = {
  nodeType: 'integration-slack',
  executionEnv: 'server',
  secretFields: ['token'],
  generateHandler(): string {
    return handlerToString(integration_slack)
  },
}
