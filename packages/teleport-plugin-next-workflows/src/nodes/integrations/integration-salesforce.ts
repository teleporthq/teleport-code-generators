import { IntegrationHandlerGenerator, handlerToString } from '../types'

async function integration_salesforce(config: any, context: Record<string, unknown>) {
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
  const instanceUrl = config.instanceUrl
  const action = config.action
  const baseUrl = instanceUrl + '/services/data/v58.0/'
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + accessToken,
  }

  switch (action) {
    case 'run-soql': {
      const response = await fetch(baseUrl + 'query/?q=' + encodeURIComponent(config.query), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to run SOQL query' }
      }
      return {
        success: true,
        records: data.records || [],
        totalSize: data.totalSize,
        done: data.done,
      }
    }
    case 'create-contact': {
      const body: Record<string, any> = {}
      if (config.firstName) {
        body.FirstName = config.firstName
      }
      if (config.lastName) {
        body.LastName = config.lastName
      }
      if (config.email) {
        body.Email = config.email
      }
      if (config.phone) {
        body.Phone = config.phone
      }
      if (config.accountId) {
        body.AccountId = config.accountId
      }
      if (config.fields) {
        Object.assign(body, config.fields)
      }
      const response = await fetch(baseUrl + 'sobjects/Contact', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to create contact' }
      }
      return { success: true, id: data.id, contact: data }
    }
    case 'get-contact': {
      let url = baseUrl + 'sobjects/Contact/' + config.contactId
      if (config.fields) {
        url = url + '?fields=' + encodeURIComponent(config.fields.join(','))
      }
      const response = await fetch(url, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to get contact' }
      }
      return { success: true, contact: data }
    }
    case 'update-contact': {
      const body: Record<string, any> = config.fields || {}
      if (config.firstName !== undefined) {
        body.FirstName = config.firstName
      }
      if (config.lastName !== undefined) {
        body.LastName = config.lastName
      }
      if (config.email !== undefined) {
        body.Email = config.email
      }
      const response = await fetch(baseUrl + 'sobjects/Contact/' + config.contactId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to update contact' }
      }
      return { success: true }
    }
    case 'delete-contact': {
      const response = await fetch(baseUrl + 'sobjects/Contact/' + config.contactId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to delete contact' }
      }
      return { success: true }
    }
    case 'query-contacts': {
      const query = config.query || 'SELECT Id,FirstName,LastName,Email FROM Contact LIMIT 200'
      const response = await fetch(baseUrl + 'query/?q=' + encodeURIComponent(query), {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to query' }
      }
      return { success: true, records: data.records || [], totalSize: data.totalSize }
    }
    case 'create-lead': {
      const body: Record<string, any> = config.fields || {}
      if (config.firstName) {
        body.FirstName = config.firstName
      }
      if (config.lastName) {
        body.LastName = config.lastName
      }
      if (config.company) {
        body.Company = config.company
      }
      if (config.email) {
        body.Email = config.email
      }
      const response = await fetch(baseUrl + 'sobjects/Lead', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to create lead' }
      }
      return { success: true, id: data.id }
    }
    case 'update-lead': {
      const body = config.fields || {}
      const response = await fetch(baseUrl + 'sobjects/Lead/' + config.leadId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to update lead' }
      }
      return { success: true }
    }
    case 'convert-lead': {
      const body: Record<string, any> = { convertedStatus: config.convertedStatus }
      if (config.accountId) {
        body.accountId = config.accountId
      }
      if (config.opportunityId) {
        body.opportunityId = config.opportunityId
      }
      const response = await fetch(baseUrl + 'sobjects/Lead/' + config.leadId + '/convert', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to convert' }
      }
      return { success: true, result: data }
    }
    case 'get-lead': {
      const response = await fetch(baseUrl + 'sobjects/Lead/' + config.leadId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to get lead' }
      }
      return { success: true, lead: data }
    }
    case 'delete-lead': {
      const response = await fetch(baseUrl + 'sobjects/Lead/' + config.leadId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to delete lead' }
      }
      return { success: true }
    }
    case 'create-opportunity': {
      const body: Record<string, any> = config.fields || {}
      if (config.name) {
        body.Name = config.name
      }
      if (config.accountId) {
        body.AccountId = config.accountId
      }
      if (config.closeDate) {
        body.CloseDate = config.closeDate
      }
      if (config.stageName) {
        body.StageName = config.stageName
      }
      if (config.amount !== undefined) {
        body.Amount = config.amount
      }
      const response = await fetch(baseUrl + 'sobjects/Opportunity', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data[0] && data[0].message) || 'Failed to create opportunity',
        }
      }
      return { success: true, id: data.id }
    }
    case 'update-opportunity': {
      const body = config.fields || {}
      const response = await fetch(
        baseUrl + 'sobjects/Opportunity/' + (config.opportunityId || config.oppId),
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(body),
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data[0] && data[0].message) || 'Failed to update opportunity',
        }
      }
      return { success: true }
    }
    case 'get-opportunity': {
      const response = await fetch(
        baseUrl + 'sobjects/Opportunity/' + (config.opportunityId || config.oppId),
        {
          method: 'GET',
          headers,
        }
      )
      const data = await __readJson(response)
      if (!response.ok) {
        return {
          success: false,
          error: (data[0] && data[0].message) || 'Failed to get opportunity',
        }
      }
      return { success: true, opportunity: data }
    }
    case 'delete-opportunity': {
      const response = await fetch(
        baseUrl + 'sobjects/Opportunity/' + (config.opportunityId || config.oppId),
        {
          method: 'DELETE',
          headers,
        }
      )
      if (!response.ok) {
        const data = await __readJson(response)
        return {
          success: false,
          error: (data[0] && data[0].message) || 'Failed to delete opportunity',
        }
      }
      return { success: true }
    }
    case 'create-account': {
      const body: Record<string, any> = config.fields || {}
      if (config.name) {
        body.Name = config.name
      }
      const response = await fetch(baseUrl + 'sobjects/Account', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to create account' }
      }
      return { success: true, id: data.id }
    }
    case 'update-account': {
      const body = config.fields || {}
      const response = await fetch(baseUrl + 'sobjects/Account/' + config.accountId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to update account' }
      }
      return { success: true }
    }
    case 'get-account': {
      const response = await fetch(baseUrl + 'sobjects/Account/' + config.accountId, {
        method: 'GET',
        headers,
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to get account' }
      }
      return { success: true, account: data }
    }
    case 'delete-account': {
      const response = await fetch(baseUrl + 'sobjects/Account/' + config.accountId, {
        method: 'DELETE',
        headers,
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to delete account' }
      }
      return { success: true }
    }
    case 'create-case': {
      const body: Record<string, any> = config.fields || {}
      if (config.subject) {
        body.Subject = config.subject
      }
      if (config.description) {
        body.Description = config.description
      }
      if (config.accountId) {
        body.AccountId = config.accountId
      }
      const response = await fetch(baseUrl + 'sobjects/Case', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to create case' }
      }
      return { success: true, id: data.id }
    }
    case 'update-case': {
      const body = config.fields || {}
      const response = await fetch(baseUrl + 'sobjects/Case/' + config.caseId, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await __readJson(response)
        return { success: false, error: (data[0] && data[0].message) || 'Failed to update case' }
      }
      return { success: true }
    }
    case 'create-task': {
      const body: Record<string, any> = config.fields || {}
      if (config.subject) {
        body.Subject = config.subject
      }
      if (config.whoId) {
        body.WhoId = config.whoId
      }
      if (config.whatId) {
        body.WhatId = config.whatId
      }
      const response = await fetch(baseUrl + 'sobjects/Task', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      const data = await __readJson(response)
      if (!response.ok) {
        return { success: false, error: (data[0] && data[0].message) || 'Failed to create task' }
      }
      return { success: true, id: data.id }
    }
    default:
      throw new Error('Unknown integration-salesforce action: ' + action)
  }
}
export const integrationSalesforce: IntegrationHandlerGenerator = {
  nodeType: 'integration-salesforce',
  executionEnv: 'server',
  secretFields: ['accessToken', 'instanceUrl'],
  generateHandler(): string {
    return handlerToString(integration_salesforce)
  },
}
