import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_youtube(config: any, context: Record<string, unknown>) {
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
  const apiKey = config.apiKey
  const accessToken = config.accessToken
  // YouTube Data API accepts either ?key=<API_KEY> or
  // ?access_token=<OAUTH_TOKEN>; use whichever the user provided.
  const authParam = accessToken ? 'access_token=' + accessToken : 'key=' + apiKey
  const action = config.action
  const baseUrl = 'https://www.googleapis.com/youtube/v3/'

  switch (action) {
    case 'search-videos': {
      const url = baseUrl + 'search'
      const params = [authParam, 'part=snippet', 'type=video']
      if (config.q) {
        params.push('q=' + encodeURIComponent(config.q))
      }
      if (config.maxResults) {
        params.push('maxResults=' + config.maxResults)
      }
      if (config.order) {
        params.push('order=' + config.order)
      }
      if (config.channelId) {
        params.push('channelId=' + config.channelId)
      }
      if (config.pageToken) {
        params.push('pageToken=' + config.pageToken)
      }
      if (config.publishedAfter) {
        params.push('publishedAfter=' + config.publishedAfter)
      }
      const response = await fetch(url + '?' + params.join('&'), { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to search videos' }
      }
      return {
        success: true,
        items: data.items || [],
        nextPageToken: data.nextPageToken,
        totalResults: data.pageInfo && data.pageInfo.totalResults,
      }
    }
    case 'get-video': {
      const parts = config.parts || ['snippet', 'contentDetails', 'statistics']
      const url =
        baseUrl + 'videos?' + authParam + '&id=' + config.videoId + '&part=' + parts.join(',')
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to get video' }
      }
      return { success: true, video: data.items && data.items[0] }
    }
    case 'list-videos': {
      const parts = config.parts || ['snippet', 'contentDetails', 'statistics']
      let url = baseUrl + 'videos?' + authParam + '&part=' + parts.join(',')
      if (config.chart) {
        url = url + '&chart=' + config.chart
      }
      if (config.id) {
        url = url + '&id=' + config.id.join(',')
      }
      if (config.maxResults) {
        url = url + '&maxResults=' + config.maxResults
      }
      if (config.regionCode) {
        url = url + '&regionCode=' + config.regionCode
      }
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to list videos' }
      }
      return { success: true, items: data.items || [], nextPageToken: data.nextPageToken }
    }
    case 'get-channel': {
      let url = baseUrl + 'channels?' + authParam + '&part=snippet,statistics'
      if (config.id) {
        url += '&id=' + config.id
      }
      if (config.forUsername) {
        url += '&forUsername=' + encodeURIComponent(config.forUsername)
      }
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to get channel' }
      }
      return { success: true, channel: data.items && data.items[0] }
    }
    case 'list-playlists': {
      let url = baseUrl + 'playlists?' + authParam + '&part=snippet'
      if (config.channelId) {
        url += '&channelId=' + config.channelId
      }
      if (config.maxResults) {
        url += '&maxResults=' + config.maxResults
      }
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to list playlists' }
      }
      return { success: true, playlists: data.items || [] }
    }
    case 'get-playlist-items': {
      let url =
        baseUrl + 'playlistItems?' + authParam + '&part=snippet&playlistId=' + config.playlistId
      if (config.maxResults) {
        url += '&maxResults=' + config.maxResults
      }
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to get playlist items' }
      }
      return { success: true, items: data.items || [] }
    }
    case 'get-comments': {
      let url = baseUrl + 'commentThreads?' + authParam + '&part=snippet&videoId=' + config.videoId
      if (config.maxResults) {
        url += '&maxResults=' + config.maxResults
      }
      const response = await fetch(url, { method: 'GET' })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to get comments' }
      }
      return { success: true, comments: data.items || [] }
    }
    case 'get-video-stats': {
      const response = await fetch(
        baseUrl + 'videos?' + authParam + '&id=' + config.videoId + '&part=statistics,snippet',
        { method: 'GET' }
      )
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to get stats' }
      }
      return { success: true, video: data.items && data.items[0] }
    }
    default:
      throw new Error('Unknown integration-youtube action: ' + action)
  }
}
export const integrationYoutube: IntegrationHandlerGenerator = {
  nodeType: 'integration-youtube',
  executionEnv: 'server',
  secretFields: ['apiKey', 'accessToken'],
  generateHandler(): string {
    return handlerToString(integration_youtube)
  },
}
