/* tslint:disable:no-eval */
import { integrationSalesforce } from '../src/nodes/integrations/integration-salesforce'

// Regression: the GUI Salesforce node form writes the opportunity id under
// `config.opportunityId` (matching the convert-lead case and the contactId /
// leadId / accountId / caseId convention used everywhere else in this handler),
// but the update / get / delete opportunity cases read `config.oppId`, which is
// never populated. Every request therefore hit `…/sobjects/Opportunity/undefined`
// and 404'd. The fix reads `config.opportunityId || config.oppId` so the form
// value is used, while any already-saved workflow that stored `oppId` still works.

function evalHandler(code: string): any {
  return eval('(' + code + ')')
}

// Capturing fetch double: records every requested URL and returns a 2xx so the
// handler walks the success path. `text()` backs the handler's `__readJson`.
function makeFetch(urls: string[]) {
  return async (url: string) => {
    urls.push(url)
    return { ok: true, text: async () => '{}' }
  }
}

describe('salesforce opportunity id resolution', () => {
  const baseConfig = {
    accessToken: 'tok',
    instanceUrl: 'https://my.salesforce.com',
  }
  const urlPrefix = 'https://my.salesforce.com/services/data/v58.0/sobjects/Opportunity/'

  it.each(['update-opportunity', 'get-opportunity', 'delete-opportunity'])(
    '%s uses config.opportunityId in the request URL',
    async (action) => {
      const handler = evalHandler(integrationSalesforce.generateHandler())
      const urls: string[] = []
      ;(global as any).fetch = makeFetch(urls)
      try {
        const res = await handler({ ...baseConfig, action, opportunityId: 'OPP-real' }, {})
        expect(res.success).toBe(true)
        expect(urls).toEqual([urlPrefix + 'OPP-real'])
        expect(urls[0]).not.toContain('undefined')
      } finally {
        delete (global as any).fetch
      }
    }
  )

  it.each(['update-opportunity', 'get-opportunity', 'delete-opportunity'])(
    '%s falls back to legacy config.oppId when opportunityId is absent',
    async (action) => {
      const handler = evalHandler(integrationSalesforce.generateHandler())
      const urls: string[] = []
      ;(global as any).fetch = makeFetch(urls)
      try {
        const res = await handler({ ...baseConfig, action, oppId: 'OPP-legacy' }, {})
        expect(res.success).toBe(true)
        expect(urls).toEqual([urlPrefix + 'OPP-legacy'])
      } finally {
        delete (global as any).fetch
      }
    }
  )

  it('prefers opportunityId over a stale oppId when both are present', async () => {
    const handler = evalHandler(integrationSalesforce.generateHandler())
    const urls: string[] = []
    ;(global as any).fetch = makeFetch(urls)
    try {
      await handler(
        { ...baseConfig, action: 'get-opportunity', opportunityId: 'OPP-new', oppId: 'OPP-old' },
        {}
      )
      expect(urls).toEqual([urlPrefix + 'OPP-new'])
    } finally {
      delete (global as any).fetch
    }
  })

  it('create-opportunity is untouched: POSTs to the collection URL with no id', async () => {
    const handler = evalHandler(integrationSalesforce.generateHandler())
    const urls: string[] = []
    ;(global as any).fetch = makeFetch(urls)
    try {
      const res = await handler(
        { ...baseConfig, action: 'create-opportunity', name: 'Big deal', opportunityId: 'OPP-x' },
        {}
      )
      expect(res.success).toBe(true)
      // No trailing id segment — the opportunityId must not leak into the create URL.
      expect(urls).toEqual(['https://my.salesforce.com/services/data/v58.0/sobjects/Opportunity'])
    } finally {
      delete (global as any).fetch
    }
  })

  it('convert-lead keeps opportunityId in the body for the conversion target', async () => {
    const handler = evalHandler(integrationSalesforce.generateHandler())
    let sentBody: any
    ;(global as any).fetch = async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body)
      return { ok: true, text: async () => '{}' }
    }
    try {
      await handler(
        {
          ...baseConfig,
          action: 'convert-lead',
          leadId: 'LEAD-1',
          convertedStatus: 'Closed - Converted',
          opportunityId: 'OPP-target',
        },
        {}
      )
      // convert-lead reads opportunityId for the conversion target — its own
      // semantics, unrelated to the CRUD-by-id fix.
      expect(sentBody.opportunityId).toBe('OPP-target')
    } finally {
      delete (global as any).fetch
    }
  })
})
