import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_greenhouse(config: any, context: Record<string, unknown>) {
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
  const action = config.action
  const baseUrl = 'https://harvest.greenhouse.io/v1/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Basic ' + btoa(apiKey + ':'),
  }
  // Greenhouse Harvest requires an `On-Behalf-Of: <user_id>` header on every
  // mutating request (POST/PATCH/DELETE) or it rejects with 422. Apply it to
  // the write actions when the node supplies an on-behalf-of / user id.
  const onBehalfOf = config.onBehalfOf || config.userId
  // Build without Object.assign/spread — this handler is .toString()'d and
  // bundled, where down-levelled spread would reference a missing tslib helper.
  let writeHeaders: Record<string, string> = headers
  if (onBehalfOf) {
    writeHeaders = { 'On-Behalf-Of': String(onBehalfOf) }
    const __hk = Object.keys(headers)
    for (let __i = 0; __i < __hk.length; __i++) {
      writeHeaders[__hk[__i]] = (headers as any)[__hk[__i]]
    }
  }

  switch (action) {
    case 'list-candidates': {
      let url = baseUrl + 'candidates'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.jobId) {
        params.push('job_id=' + config.jobId)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list candidates' }
      }
      return { success: true, candidates: data }
    }
    case 'get-candidate': {
      const response = await fetch(baseUrl + 'candidates/' + config.candidateId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get candidate' }
      }
      return { success: true, candidate: data }
    }
    case 'list-jobs': {
      let url = baseUrl + 'jobs'
      const params = []
      if (config.perPage) {
        params.push('per_page=' + config.perPage)
      }
      if (config.page) {
        params.push('page=' + config.page)
      }
      if (config.status) {
        params.push('status=' + config.status)
      }
      if (params.length > 0) {
        url = url + '?' + params.join('&')
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list jobs' }
      }
      return { success: true, jobs: data }
    }
    case 'get-job': {
      const response = await fetch(baseUrl + 'jobs/' + config.jobId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get job' }
      }
      return { success: true, job: data }
    }
    case 'create-candidate': {
      const body = { first_name: config.firstName, last_name: config.lastName, email: config.email }
      if (config.phone) {
        ;(body as any).phone = config.phone
      }
      const response = await fetch(baseUrl + 'candidates', {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to create candidate' }
      }
      return { success: true, candidate: data }
    }
    case 'list-applications': {
      let url = baseUrl + 'applications'
      if (config.jobId) {
        url += '?job_id=' + config.jobId
      }
      const response = await fetch(url, { method: 'GET', headers })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to list applications' }
      }
      return { success: true, applications: data }
    }
    case 'get-application': {
      const response = await fetch(baseUrl + 'applications/' + config.applicationId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: data.message || 'Failed to get application' }
      }
      return { success: true, application: data }
    }
    case 'advance-application': {
      const response = await fetch(baseUrl + 'applications/' + config.applicationId + '/advance', {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ from_stage_id: config.fromStageId, to_stage_id: config.toStageId }),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: data.message || 'Failed to advance' }
      }
      return { success: true }
    }
    default:
      throw new Error('Unknown integration-greenhouse action: ' + action)
  }
}
export const integrationGreenhouse: IntegrationHandlerGenerator = {
  nodeType: 'integration-greenhouse',
  executionEnv: 'server',
  secretFields: ['apiKey'],
  generateHandler(): string {
    return handlerToString(integration_greenhouse)
  },
}
