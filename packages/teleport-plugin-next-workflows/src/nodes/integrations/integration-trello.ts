import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_trello(config: any, context: Record<string, unknown>) {
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
  const token = config.token
  const action = config.action
  const baseUrl = 'https://api.trello.com/1/'
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  function authParams() {
    return 'key=' + apiKey + '&token=' + token
  }

  function withAuth(url) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + authParams()
  }

  switch (action) {
    case 'create-card': {
      const body: Record<string, any> = {
        idList: config.listId,
        name: config.name,
      }
      if (config.desc) {
        body.desc = config.desc
      }
      if (config.pos) {
        body.pos = config.pos
      }
      if (config.due) {
        body.due = config.due
      }
      if (config.idMembers) {
        body.idMembers = config.idMembers.join(',')
      }
      if (config.idLabels) {
        body.idLabels = config.idLabels.join(',')
      }
      if (config.urlSource) {
        body.urlSource = config.urlSource
      }
      const response = await fetch(withAuth(baseUrl + 'cards'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create card' }
      }
      return { success: true, card: data }
    }
    case 'get-card': {
      const url = baseUrl + 'cards/' + config.cardId
      const params = []
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields.join(',')))
      }
      if (config.members) {
        params.push('members=true')
      }
      if (config.attachments) {
        params.push('attachments=true')
      }
      if (config.checklists) {
        params.push('checklists=all')
      }
      const queryStr = params.length > 0 ? '?' + params.join('&') : ''
      const response = await fetch(withAuth(url + queryStr), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get card' }
      }
      return { success: true, card: data }
    }
    case 'list-cards': {
      const url = baseUrl + 'lists/' + config.listId + '/cards'
      const params = []
      if (config.fields) {
        params.push('fields=' + encodeURIComponent(config.fields.join(',')))
      }
      if (config.filter) {
        params.push('filter=' + config.filter)
      }
      const queryStr = params.length > 0 ? '?' + params.join('&') : ''
      const response = await fetch(withAuth(url + queryStr), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list cards' }
      }
      return { success: true, cards: data }
    }
    case 'create-board': {
      const body: Record<string, any> = { name: config.name }
      if (config.desc) {
        body.desc = config.desc
      }
      if (config.defaultLists !== undefined) {
        body.defaultLists = config.defaultLists
      }
      const response = await fetch(withAuth(baseUrl + 'boards'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create board' }
      }
      return { success: true, board: data }
    }
    case 'get-board': {
      const response = await fetch(withAuth(baseUrl + 'boards/' + config.boardId), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get board' }
      }
      return { success: true, board: data }
    }
    case 'update-board': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.desc !== undefined) {
        body.desc = config.desc
      }
      const response = await fetch(withAuth(baseUrl + 'boards/' + config.boardId), {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update board' }
      }
      return { success: true, board: data }
    }
    case 'delete-board': {
      const response = await fetch(withAuth(baseUrl + 'boards/' + config.boardId), {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete board' }
      }
      return { success: true }
    }
    case 'create-list': {
      const body: Record<string, any> = { name: config.name, idBoard: config.boardId }
      if (config.pos) {
        body.pos = config.pos
      }
      const response = await fetch(withAuth(baseUrl + 'lists'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create list' }
      }
      return { success: true, list: data }
    }
    case 'get-list': {
      const response = await fetch(withAuth(baseUrl + 'lists/' + config.listId), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get list' }
      }
      return { success: true, list: data }
    }
    case 'update-list': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.pos !== undefined) {
        body.pos = config.pos
      }
      const response = await fetch(withAuth(baseUrl + 'lists/' + config.listId), {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update list' }
      }
      return { success: true, list: data }
    }
    case 'archive-list': {
      const response = await fetch(withAuth(baseUrl + 'lists/' + config.listId + '/closed'), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ value: true }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to archive list' }
      }
      return { success: true, list: data }
    }
    case 'update-card': {
      const body: Record<string, any> = {}
      if (config.name !== undefined) {
        body.name = config.name
      }
      if (config.desc !== undefined) {
        body.desc = config.desc
      }
      if (config.due !== undefined) {
        body.due = config.due
      }
      if (config.idList !== undefined) {
        body.idList = config.idList
      }
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId), {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to update card' }
      }
      return { success: true, card: data }
    }
    case 'delete-card': {
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId), {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to delete card' }
      }
      return { success: true }
    }
    case 'move-card': {
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ idList: config.listId }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to move card' }
      }
      return { success: true, card: data }
    }
    case 'add-comment': {
      const response = await fetch(
        withAuth(baseUrl + 'cards/' + config.cardId + '/actions/comments'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: config.text }),
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add comment' }
      }
      return { success: true, comment: data }
    }
    case 'add-member': {
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId + '/idMembers'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: config.memberId }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add member' }
      }
      return { success: true, card: data }
    }
    case 'remove-member': {
      const response = await fetch(
        withAuth(baseUrl + 'cards/' + config.cardId + '/idMembers/' + config.memberId),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to remove member' }
      }
      return { success: true }
    }
    case 'add-label': {
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId + '/idLabels'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: config.labelId }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add label' }
      }
      return { success: true, card: data }
    }
    case 'remove-label': {
      const response = await fetch(
        withAuth(baseUrl + 'cards/' + config.cardId + '/idLabels/' + config.labelId),
        { method: 'DELETE', headers }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to remove label' }
      }
      return { success: true }
    }
    case 'create-checklist': {
      const body: Record<string, any> = { name: config.name }
      if (config.idCard) {
        body.idCard = config.idCard
      }
      const response = await fetch(withAuth(baseUrl + 'checklists'), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create checklist' }
      }
      return { success: true, checklist: data }
    }
    case 'add-checklist-item': {
      const body: Record<string, any> = { name: config.name }
      if (config.pos) {
        body.pos = config.pos
      }
      const response = await fetch(
        withAuth(baseUrl + 'checklists/' + config.checklistId + '/checkItems'),
        { method: 'POST', headers, body: JSON.stringify(body) }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to add checklist item' }
      }
      return { success: true, checkItem: data }
    }
    case 'attach-file': {
      const body: Record<string, any> = {}
      if (config.url) {
        body.url = config.url
      }
      if (config.name) {
        body.name = config.name
      }
      const response = await fetch(withAuth(baseUrl + 'cards/' + config.cardId + '/attachments'), {
        method: 'POST',
        headers,
        body: JSON.stringify(Object.keys(body).length ? body : { url: config.url || '' }),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to attach file' }
      }
      return { success: true, attachment: data }
    }
    default:
      throw new Error('Unknown integration-trello action: ' + action)
  }
}
export const integrationTrello: IntegrationHandlerGenerator = {
  nodeType: 'integration-trello',
  executionEnv: 'server',
  secretFields: ['apiKey', 'token'],
  generateHandler(): string {
    return handlerToString(integration_trello)
  },
}
