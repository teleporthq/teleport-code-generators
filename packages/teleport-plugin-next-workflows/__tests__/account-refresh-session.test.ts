import { loadHandler, HandlerFn } from './_helpers/load-handler'

// After a profile save the NextAuth JWT still carries the PREVIOUS name/image:
// the generated jwt callback only re-reads the users row once per refresh
// interval unless next-auth passes `trigger: 'update'`, which only
// `useSession().update()` does. `account-refresh-session` is the node that
// calls it and then republishes the result to the two consumers that would
// otherwise keep the stale value: the `teleport_auth_user` localStorage mirror
// `account-get-current` falls back to, and GlobalContext's `currentUser` (which
// the account-menu avatar binds to) via `teleport:auth-user-changed`.

interface RefreshResult {
  id?: string
  image?: string
  user: Record<string, unknown> | null
  refreshed: boolean
  error?: unknown
}

describe('account-refresh-session', () => {
  const handler: HandlerFn = loadHandler('account-refresh-session')
  let events: Array<{ type: string; detail: unknown }>
  let stored: Record<string, string>

  const installWindow = (refreshSession: unknown): void => {
    events = []
    stored = { teleport_auth_user: JSON.stringify({ id: 'u-1', image: 'https://cdn/old.png' }) }
    ;(globalThis as any).window = {
      __teleportNextAuth: refreshSession === undefined ? {} : { refreshSession },
      localStorage: {
        getItem: (k: string) => (k in stored ? stored[k] : null),
        setItem: (k: string, v: string) => {
          stored[k] = v
        },
        removeItem: (k: string) => {
          delete stored[k]
        },
      },
      dispatchEvent: (event: { type: string; detail: unknown }) => events.push(event),
    }
    ;(globalThis as any).CustomEvent = class {
      public type: string
      public detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init ? init.detail : undefined
      }
    }
  }

  afterEach(() => {
    delete (globalThis as any).window
    delete (globalThis as any).CustomEvent
  })

  it('publishes the refreshed user to GlobalContext and the localStorage mirror', async () => {
    const fresh = { id: 'u-1', name: 'Ada Lovelace', image: 'https://cdn/new.png', role: 'user' }
    installWindow(async () => ({ user: fresh, expires: '2099-01-01' }))

    const result = (await handler({}, {})) as RefreshResult

    expect(result.refreshed).toBe(true)
    expect(result.user).toEqual(fresh)
    // Flat fields too — same output contract as account-get-current.
    expect(result.image).toBe('https://cdn/new.png')
    expect(result.id).toBe('u-1')
    expect(JSON.parse(stored.teleport_auth_user).image).toBe('https://cdn/new.png')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('teleport:auth-user-changed')
    expect(events[0].detail).toEqual({ user: fresh })
  })

  it('never publishes a null user — that would sign the visitor out of the UI', async () => {
    // `update()` resolves to undefined while the provider is still loading.
    installWindow(async (): Promise<undefined> => undefined)

    const result = (await handler({}, {})) as RefreshResult

    expect(result.refreshed).toBe(false)
    expect(events).toHaveLength(0)
    expect(JSON.parse(stored.teleport_auth_user).image).toBe('https://cdn/old.png')
  })

  it('degrades quietly when the session bridge is unavailable', async () => {
    installWindow(undefined)

    const result = (await handler({}, {})) as RefreshResult

    expect(result.refreshed).toBe(false)
    expect(events).toHaveLength(0)
  })

  it('never returns a string error key (that would abort the workflow)', async () => {
    installWindow(async () => {
      throw new Error('network down')
    })

    const result = (await handler({}, {})) as RefreshResult

    expect(result.refreshed).toBe(false)
    expect(typeof result.error).not.toBe('string')
    expect(events).toHaveLength(0)
  })

  it('is inert on the server', async () => {
    const result = (await handler({}, {})) as RefreshResult
    expect(result.refreshed).toBe(false)
    expect(result.user).toBeNull()
  })
})
