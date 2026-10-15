import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'

describe('REST API fetcher with API key authorization', () => {
  /*
   * The editor's data fetcher sends the key as `X-API-Key`. The live site sent
   * `Authorization: ApiKey …`, so a source that worked on the canvas failed once
   * published.
   */
  it('sends the key in the same header the editor sends', () => {
    const code = generateRESTAPIFetcher({
      url: 'https://api.example.com/items',
      method: 'GET',
      authorization: { type: 'api-key', credentials: { apiKey: 'k-1' } },
    })
    expect(code).toContain("headers['X-API-Key'] = 'k-1'")
    expect(code).not.toContain('ApiKey ')
  })
})
