import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'
import { generateJavaScriptFetcher } from '../src/fetchers/javascript'

/**
 * Runs a generated fetcher's handler and returns what it answered, so these
 * assert on BEHAVIOUR rather than on the shape of the emitted source.
 */
const runHandler = async (
  code: string,
  query: Record<string, unknown>,
  fetchImpl?: () => Promise<unknown>
) => {
  const withoutImports = code.replace(/^import\s+.*?$/gm, '')
  const factory = new Function(
    'fetch',
    `${withoutImports.replace('export default async function handler', 'async function handler')}
    return handler`
  )

  const handler = factory(
    fetchImpl || (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }))
  )

  let payload: Record<string, unknown> = {}
  const res = {
    status: () => res,
    json: (data: Record<string, unknown>) => {
      payload = data
      return res
    },
  }

  await handler({ query, body: undefined }, res)
  return payload
}

const respondWith = (body: unknown) => () =>
  Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) })

describe('REST API fetcher — collection path', () => {
  const baseConfig = { url: 'https://api.test/items', method: 'GET' }

  it('returns a bare list unchanged when no path is configured', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      {},
      respondWith([{ id: 1 }, { id: 2 }])
    )

    expect(result.success).toBe(true)
    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('leaves a wrapped payload alone when the request asks for no path', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      {},
      respondWith({ results: [{ id: 1 }] })
    )

    expect(result.data).toEqual({ results: [{ id: 1 }] })
  })

  it('unwraps using the list location the request carries', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      { collectionPath: JSON.stringify(['results']) },
      respondWith({ results: [{ id: 1 }, { id: 2 }] })
    )

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('unwraps a nested list location', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      { collectionPath: JSON.stringify(['response', 'items']) },
      respondWith({ response: { items: [{ id: 1 }] } })
    )

    expect(result.data).toEqual([{ id: 1 }])
  })

  it('ignores a list location left on the config by an older build', async () => {
    // The path belongs to the details page and travels per request. Baking a
    // stale config value into the fetcher would unwrap for every caller,
    // including the list bindings authored against the wrapped response.
    const result = await runHandler(
      generateRESTAPIFetcher({ ...baseConfig, collectionPath: ['results'] }),
      {},
      respondWith({ results: [{ id: 1 }] })
    )

    expect(result.data).toEqual({ results: [{ id: 1 }] })
  })

  it('falls back to the whole payload when the requested path no longer resolves', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      { collectionPath: JSON.stringify(['results']) },
      respondWith({ items: [{ id: 1 }] })
    )

    expect(result.data).toEqual({ items: [{ id: 1 }] })
  })

  it('applies filters and limits to an unwrapped list', async () => {
    const result = await runHandler(
      generateRESTAPIFetcher(baseConfig),
      {
        collectionPath: JSON.stringify(['results']),
        filters: JSON.stringify([
          { type: 'condition', source: 'slug', destination: 'b', operand: '=' },
        ]),
        limit: '1',
      },
      respondWith({ results: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] })
    )

    expect(result.data).toEqual([{ slug: 'b' }])
  })

  it('emits the same code whatever list location the config carries', () => {
    expect(generateRESTAPIFetcher(baseConfig)).toEqual(
      generateRESTAPIFetcher({ ...baseConfig, collectionPath: ['results'] })
    )
  })
})

describe('REST API fetcher — configured request body', () => {
  it('sends the configured body when the caller supplies none', async () => {
    let sent: string | undefined
    await runHandler(
      generateRESTAPIFetcher({
        url: 'https://api.test/search',
        method: 'POST',
        bodyType: 'json',
        body: '{"pageSize":50}',
      }),
      {},
      (...args: unknown[]) => {
        sent = (args[1] as { body?: string })?.body
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      }
    )

    expect(sent).toBe('{"pageSize":50}')
  })

  it('sends nothing when no body is configured, exactly as before', async () => {
    let sent: string | undefined = 'untouched'
    await runHandler(
      generateRESTAPIFetcher({ url: 'https://api.test/search', method: 'POST' }),
      {},
      (...args: unknown[]) => {
        sent = (args[1] as { body?: string })?.body
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      }
    )

    expect(sent).toBeUndefined()
  })
})

describe('JavaScript fetcher — collection path', () => {
  it('returns a bare list unchanged', async () => {
    const result = await runHandler(
      generateJavaScriptFetcher({ code: '[{ "id": 1 }, { "id": 2 }]' }),
      {}
    )

    expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('unwraps using the list location the request carries', async () => {
    const result = await runHandler(
      generateJavaScriptFetcher({ code: '({ "items": [{ "id": 1 }] })' }),
      {
        collectionPath: JSON.stringify(['items']),
      }
    )

    expect(result.data).toEqual([{ id: 1 }])
  })

  it('emits the same code whatever list location the config carries', () => {
    expect(generateJavaScriptFetcher({ code: '[]' })).toEqual(
      generateJavaScriptFetcher({ code: '[]', collectionPath: ['items'] })
    )
  })
})
