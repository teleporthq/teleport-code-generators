import generator from '@babel/generator'
import * as types from '@babel/types'
import { generateRemoteResourceASTs } from '../../src/utils/ast-utils'
import type { UIDLResourceItem } from '@teleporthq/teleport-types'

// Renders the statements produced for a resource fetcher into a code string so
// we can assert the exact Authorization header that ends up in the generated
// project.
const renderResource = (resource: UIDLResourceItem): string => {
  const statements = generateRemoteResourceASTs(resource) as types.Statement[]
  const program = types.program(statements)
  return generator(program).code
}

const baseResource = (headers: UIDLResourceItem['headers']): UIDLResourceItem => ({
  name: 'CmsResource',
  path: {
    baseUrl: { type: 'env', content: 'CMS_URL' },
    route: { type: 'static', content: 'api/Portfolio' },
  },
  method: 'GET',
  headers,
  response: { type: 'none' },
})

describe('resource Authorization header — auth scheme', () => {
  it('defaults to `Bearer ` when no authScheme is set (Contentful/Strapi/Flotiq/Caisy)', () => {
    const code = renderResource(
      baseResource({ authToken: { type: 'env', content: 'CMS_ACCESS_TOKEN' } })
    )
    expect(code).toContain(`Authorization: \`Bearer \${process.env.CMS_ACCESS_TOKEN}\``)
  })

  it('uses a custom scheme prefix from headers.authScheme (WordPress Basic auth)', () => {
    const code = renderResource(
      baseResource({
        authToken: { type: 'env', content: 'CMS_ACCESS_TOKEN' },
        authScheme: { type: 'static', content: 'Basic ' },
      })
    )
    // No double scheme — the token is the base64 credential, prefixed with `Basic `.
    expect(code).toContain(`Authorization: \`Basic \${process.env.CMS_ACCESS_TOKEN}\``)
    expect(code).not.toContain('Bearer ')
  })

  it('never emits authScheme as its own HTTP header', () => {
    const code = renderResource(
      baseResource({
        authToken: { type: 'env', content: 'CMS_ACCESS_TOKEN' },
        authScheme: { type: 'static', content: 'Basic ' },
      })
    )
    expect(code).not.toContain('authScheme')
  })
})
