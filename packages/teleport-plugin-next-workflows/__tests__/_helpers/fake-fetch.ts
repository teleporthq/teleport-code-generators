import { EventEmitter } from 'events'
import { Readable } from 'stream'

export interface FetchCall {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  /** The body parsed as JSON, or null when it is not JSON. */
  json: any
}

export interface FakeAnswer {
  status?: number
  body?: unknown
}

export type FetchResponder = (call: FetchCall) => FakeAnswer

/** Process-wide caches the drivers keep, cleared around every fake-fetch run. */
const DRIVER_CACHES = ['__paypalBaseUrlCache', '__coingateBaseUrlCache', '__squareBaseUrlCache']

/**
 * Runs `run` with `globalThis.fetch` answered by `respond` (status 200 unless
 * it says otherwise), recording every call, then restores fetch and clears the
 * drivers' environment caches so no test leaks into the next.
 */
export const withFetch = async <T>(
  respond: FetchResponder,
  run: (calls: FetchCall[]) => Promise<T>
): Promise<T> => {
  const calls: FetchCall[] = []
  const scope = globalThis as Record<string, unknown>
  const previous = scope.fetch
  scope.fetch = async (
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ) => {
    const body = typeof init.body === 'string' ? init.body : ''
    let json: any = null
    try {
      json = body ? JSON.parse(body) : null
    } catch (_e) {
      json = null
    }
    const call: FetchCall = {
      url,
      method: init.method || 'GET',
      headers: init.headers || {},
      body,
      json,
    }
    calls.push(call)
    const answer = respond(call)
    const status = answer.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => answer.body,
      text: async () => JSON.stringify(answer.body ?? null),
    }
  }
  try {
    return await run(calls)
  } finally {
    scope.fetch = previous
    DRIVER_CACHES.forEach((key) => {
      delete scope[key]
    })
  }
}

/** Runs `run` with `env` set (an `undefined` value removes the variable), then restores. */
export const withEnv = async <T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>
): Promise<T> => {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key]
    if (env[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = env[key]
    }
  }
  try {
    return await run()
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  }
}

/**
 * `dns`, `http` and `https` for a generated route under test, answered by the
 * fake `globalThis.fetch` the test installed (see `withFetch`).
 *
 * The general-http-request node never calls `fetch`: it connects through its
 * own DNS lookup and `http(s).request`, so it can refuse private addresses on
 * the address it actually connects to. A route `require`-shim that answers
 * these three ids from here lets that node reach the test's fake fetch, with
 * every name resolving to one public address.
 */
export const FETCH_BACKED_NETWORK: Record<string, unknown> = (() => {
  const PUBLIC_ADDRESS = { address: '93.184.216.34', family: 4 }
  const dns = {
    lookup(_hostname: string, options: any, callback: any) {
      if (options && options.all) {
        callback(null, [PUBLIC_ADDRESS])
      } else {
        callback(null, PUBLIC_ADDRESS.address, PUBLIC_ADDRESS.family)
      }
    },
  }
  const transport = (protocol: string) => ({
    request(options: any, onResponse: (res: any) => void) {
      const req: any = new EventEmitter()
      const chunks: Buffer[] = []
      req.write = (chunk: unknown) => {
        chunks.push(Buffer.from(chunk as string))
        return true
      }
      req.destroy = (): void => undefined
      req.end = () => {
        options.lookup(options.hostname, { all: true }, async (err: unknown) => {
          if (err) {
            req.emit('error', err)
            return
          }
          try {
            const port = options.port ? ':' + options.port : ''
            const headers: Record<string, string> = {}
            Object.keys(options.headers || {}).forEach((key) => {
              headers[key] = String(options.headers[key])
            })
            const answer = await (globalThis as any).fetch(
              protocol + '//' + options.hostname + port + options.path,
              {
                method: options.method,
                headers,
                body: chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : undefined,
              }
            )
            const text = answer && typeof answer.text === 'function' ? await answer.text() : ''
            const res: any = Readable.from(text ? [Buffer.from(text)] : [])
            res.statusCode = answer.status
            res.statusMessage = ''
            res.headers = {}
            if (answer.headers && typeof answer.headers.forEach === 'function') {
              answer.headers.forEach((value: string, key: string) => {
                res.headers[String(key).toLowerCase()] = value
              })
            }
            onResponse(res)
          } catch (fetchError) {
            req.emit('error', fetchError)
          }
        })
      }
      return req
    },
  })
  return { dns, http: transport('http:'), https: transport('https:') }
})()
