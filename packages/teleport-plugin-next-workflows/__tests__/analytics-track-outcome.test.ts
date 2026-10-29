import { nodeRegistry } from '../src/nodes'
import { resolveHandlerEntryName } from '../src/nodes/types'
import { assertHandlerHasNoModuleRefs } from '../src/nodes/analytics/commerce-tracking'
import { TRACK_LEAD_SOURCE, TRACKER_IDS_EXPRESSION } from '../src/trigger-generator'

/**
 * `analytics-track-outcome` reports what a visit produced. One node, two
 * bodies: the browser hands the outcome to the tracker, the server posts money
 * outcomes with the server key. Both must stay free of module references (a
 * handler is serialized) and must never throw into a checkout.
 */
const NODE_TYPE = 'analytics-track-outcome'

type Handler = (
  config: Record<string, unknown>,
  context: Record<string, unknown>
) => Promise<unknown>

function evalHandler(source: string, globals: Record<string, unknown>): Handler {
  const entry = resolveHandlerEntryName(source, NODE_TYPE)
  const names = Object.keys(globals)
  // tslint:disable-next-line:function-constructor
  const factory = new Function(...names, `${source}\nreturn ${entry};`)
  return factory(...names.map((name) => globals[name]))
}

describe('analytics-track-outcome node', () => {
  const generator = nodeRegistry[NODE_TYPE]

  it('is registered as universal with a client and a server body free of module refs', () => {
    expect(generator).toBeDefined()
    expect(generator.executionEnv).toBe('universal')
    expect(() => assertHandlerHasNoModuleRefs(generator.generateHandler(), NODE_TYPE)).not.toThrow()
    expect(() =>
      assertHandlerHasNoModuleRefs(generator.generateServerHandler?.() ?? '', NODE_TYPE)
    ).not.toThrow()
    expect(resolveHandlerEntryName(generator.generateHandler(), NODE_TYPE)).toBe(
      'analytics_track_outcome'
    )
  })

  it('client: hands a browser outcome to the tracker and refuses money names', async () => {
    const tracked: unknown[] = []
    const handler = evalHandler(generator.generateHandler(), {
      window: {
        tpAnalytics: { track: (name: string, detail: unknown) => tracked.push([name, detail]) },
      },
    })
    expect(await handler({ name: 'lead', recordId: 'form-1' }, {})).toEqual({ sent: true })
    expect(tracked).toEqual([['lead', expect.objectContaining({ recordId: 'form-1' })]])
    expect(await handler({ name: 'purchase', value: 10 }, {})).toEqual({
      sent: false,
      reason: 'server-only',
    })
    expect(tracked).toHaveLength(1)
  })

  it('client: is a silent no-op without the tracker', async () => {
    const handler = evalHandler(generator.generateHandler(), { window: {} })
    expect(await handler({ name: 'newsletter' }, {})).toEqual({
      sent: false,
      reason: 'tracker-unavailable',
    })
  })

  it('server: posts the outcome with the server key and the ids the trigger stamped', async () => {
    const calls: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> =
      []
    const handler = evalHandler(generator.generateServerHandler?.() ?? '', {
      globalThis: {
        process: {
          env: {
            NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example/',
            NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'tpa_key',
            TELEPORT_ANALYTICS_SERVER_KEY: 'tpas_secret',
          },
        },
      },
      fetch: (url: string, init: { headers: Record<string, string>; body: string }) => {
        calls.push({ url, init })
        return Promise.resolve({ status: 202 })
      },
      AbortController: undefined,
    })
    const result = await handler(
      {
        name: 'purchase',
        value: '49.90',
        currency: 'EUR',
        outcomeId: 'ord-1',
        attribution: { utm_source: 'facebook', visitor_id: 'aid-1' },
      },
      { __tpa: { sessionId: 'sid-1', visitorId: null, path: '/checkout' } }
    )
    expect(result).toEqual({ sent: true, status: 202 })
    expect(calls[0].url).toBe('https://analytics.example/events/tpa_key/server')
    expect(calls[0].init.headers['x-tp-server-key']).toBe('tpas_secret')
    const body = JSON.parse(calls[0].init.body)
    expect(body.outcomes[0]).toMatchObject({
      name: 'purchase',
      value: 49.9,
      currency: 'EUR',
      outcomeId: 'ord-1',
      sessionId: 'sid-1',
      visitorId: 'aid-1',
      path: '/checkout',
      attribution: { utmSource: 'facebook' },
    })
  })

  it('server: answers not-configured without the key and never throws on a network failure', async () => {
    const unconfigured = evalHandler(generator.generateServerHandler?.() ?? '', {
      globalThis: { process: { env: {} } },
      fetch: () => Promise.reject(new Error('unreachable')),
      AbortController: undefined,
    })
    expect(await unconfigured({ name: 'purchase', outcomeId: 'o' }, {})).toEqual({
      sent: false,
      reason: 'not-configured',
    })
    const offline = evalHandler(generator.generateServerHandler?.() ?? '', {
      globalThis: {
        process: {
          env: {
            NEXT_PUBLIC_TELEPORT_ANALYTICS_URL: 'https://analytics.example',
            NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY: 'k',
            TELEPORT_ANALYTICS_SERVER_KEY: 's',
          },
        },
      },
      fetch: () => Promise.reject(new Error('unreachable')),
      AbortController: undefined,
    })
    expect(await offline({ name: 'booking_made', outcomeId: 'b' }, {})).toEqual({
      sent: false,
      reason: 'network',
    })
  })

  it('stamps the tracker ids on every trigger context and reports a sent form as a lead', () => {
    expect(TRACKER_IDS_EXPRESSION).toContain('window.tpAnalytics.ids()')
    expect(TRACK_LEAD_SOURCE('form-9')).toContain("track('lead', { recordId: 'form-9' })")
    expect(TRACK_LEAD_SOURCE('form-9')).toContain("typeof window !== 'undefined'")
  })
})
