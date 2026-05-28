import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_whatsapp(config: any, context: Record<string, unknown>) {
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
  const accessToken = config.accessToken
  const phoneNumberId = config.phoneNumberId
  const action = config.action
  const baseUrl = 'https://graph.facebook.com/v18.0/' + phoneNumberId + '/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'send-message': {
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: config.to,
        type: 'text',
        text: { preview_url: config.previewUrl || false, body: config.body },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to send message' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'send-template': {
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: config.to,
        type: 'template',
        template: {
          name: config.templateName,
          language: { code: config.languageCode || 'en_US' },
          components: config.components || [],
        },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to send template' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'send-media': {
      // Schema canonical names are `type` and `url`; older workflows used
      // `mediaType` and `mediaUrl`. Accept either.
      const mediaTypeVal = config.type || config.mediaType || 'image'
      const mediaUrlVal = config.url || config.mediaUrl
      const body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: config.to,
        type: mediaTypeVal,
      }
      body[mediaTypeVal] = { link: mediaUrlVal }
      if (config.caption) {
        body[mediaTypeVal].caption = config.caption
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed to send media' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'send-location': {
      const body = {
        messaging_product: 'whatsapp',
        to: config.to,
        type: 'location',
        location: {
          latitude: config.latitude,
          longitude: config.longitude,
          name: config.name || '',
          address: config.address || '',
        },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'mark-as-read': {
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: config.messageId,
        }),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true }
    }
    case 'send-contacts': {
      const body = {
        messaging_product: 'whatsapp',
        to: config.to,
        type: 'contacts',
        contacts: config.contacts || [],
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'send-interactive-button': {
      const body = {
        messaging_product: 'whatsapp',
        to: config.to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: config.body },
          action: { buttons: config.buttons || [] },
        },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'send-interactive-list': {
      const body = {
        messaging_product: 'whatsapp',
        to: config.to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: config.body },
          action: { button: config.buttonText, sections: config.sections || [] },
        },
      }
      const response = await fetch(baseUrl + 'messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true, messageId: data.messages && data.messages[0] && data.messages[0].id }
    }
    case 'get-media-url': {
      const response = await fetch('https://graph.facebook.com/v18.0/' + config.mediaId, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + accessToken },
      })
      const data = await __readJson(response)
      if (data.error) {
        return { success: false, error: data.error.message || 'Failed' }
      }
      return { success: true, url: data.url }
    }
    default:
      throw new Error('Unknown integration-whatsapp action: ' + action)
  }
}
export const integrationWhatsapp: IntegrationHandlerGenerator = {
  nodeType: 'integration-whatsapp',
  executionEnv: 'server',
  secretFields: ['accessToken', 'phoneNumberId'],
  generateHandler(): string {
    return handlerToString(integration_whatsapp)
  },
}
