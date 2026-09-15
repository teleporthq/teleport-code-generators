import { generateRESTAPIFetcher } from '../src/fetchers/rest-api'
import { generateCountFetcher } from '../src/count-fetchers'

/**
 * Counting re-runs the fetch handler and measures its result, so it depends on
 * the same `collectionPath` the fetch does. Dropping it on the way through left
 * the handler holding the wrapper object — not an array — and the count came
 * back 0 for a list that plainly had rows.
 */
const runCount = async (query: Record<string, unknown>, body: unknown) => {
  const source = `${generateRESTAPIFetcher({ url: 'https://api.test/items', method: 'GET' })}
${generateCountFetcher({ type: 'rest-api', config: {} } as never, 'data')}`

  const withoutImports = source.replace(/^import\s+.*?$/gm, '')
  const factory = new Function(
    'fetch',
    `${withoutImports.replace('export default async function handler', 'async function handler')}
    return getCount`
  )

  const getCount = factory(() =>
    Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(body) })
  )

  let payload: Record<string, unknown> = {}
  const res = {
    status: () => res,
    json: (data: Record<string, unknown>) => {
      payload = data
      return res
    },
  }

  await getCount({ query }, res)
  return payload
}

const WRAPPED = { categories: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }] }

describe('REST count fetcher — collection path', () => {
  it('counts the records the path points at', async () => {
    const result = await runCount({ collectionPath: JSON.stringify(['categories']) }, WRAPPED)

    expect(result.success).toBe(true)
    expect(result.count).toBe(3)
  })

  it('counts a bare list with no path, exactly as before', async () => {
    const result = await runCount({}, [{ slug: 'a' }, { slug: 'b' }])

    expect(result.count).toBe(2)
  })

  it('still reports 0 for a payload that is not a list and has no path', async () => {
    const result = await runCount({}, WRAPPED)

    expect(result.count).toBe(0)
  })
})
