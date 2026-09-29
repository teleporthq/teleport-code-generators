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
