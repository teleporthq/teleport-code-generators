import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_get_current(_config: unknown, context: Record<string, unknown>) {
  const baseUrl = (context && (context as any).__baseUrl) || ''
  // The declared output contract (node-context-schemas) exposes the user's
  // fields at the TOP LEVEL (id, email, name, image, ...). Workflow builders
  // read e.g. `wfCtx(node, ['id'])` for a row's user_id, and the AI reads the
  // flat fields too. Emit the user's fields flat AND keep a `user` object for
  // anything that reads `.user`.
  // Copy the user's fields onto a fresh object (no Object.assign/spread — this
  // handler is .toString()'d and bundled, where down-levelled spread would
  // reference a tslib helper that doesn't exist at runtime).
  const __out = (user: any) => {
    const o: any = {}
    if (user) {
      const ks = Object.keys(user)
      for (let i = 0; i < ks.length; i++) {
        o[ks[i]] = user[ks[i]]
      }
    }
    o.user = user || null
    return o
  }
  // Mirror of the last known user, read when the session endpoint is
  // unreachable so an offline click still knows who is signed in.
  const __cache = (user: any) => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      if (user) {
        window.localStorage.setItem('teleport_auth_user', JSON.stringify(user))
      } else {
        window.localStorage.removeItem('teleport_auth_user')
      }
    } catch (_e) {}
  }

  // `_app` renders NextAuth's SessionProvider on every page, so the browser has
  // already fetched and is holding the session in memory; session-provider.js
  // republishes it on `window.__teleportNextAuth`. Re-fetching it over HTTP cost
  // a full round trip (~925ms on a published deployment, because the jwt
  // callback re-reads the `users` row) BEFORE the workflow's own request could
  // start — for data the page had since it mounted.
  //
  // Only 'authenticated' short-circuits. 'loading' means the provider's first
  // fetch has not settled; 'unauthenticated' is also what next-auth reports when
  // that fetch FAILED, and treating a transient error as "signed out" would send
  // a signed-in visitor down the guest branch. Both fall through to the fetch —
  // which for a guest is the cheap case anyway, since the jwt callback returns
  // before touching the database when there is no token.
  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).__teleportNextAuth
      const snapshot =
        bridge && typeof bridge.getSession === 'function' ? bridge.getSession() : null
      if (snapshot && snapshot.status === 'authenticated') {
        const liveUser = snapshot.session && snapshot.session.user ? snapshot.session.user : null
        if (liveUser) {
          __cache(liveUser)
          return __out(liveUser)
        }
      }
    } catch (_e) {}
  }

  try {
    const response = await fetch(baseUrl + '/api/auth/session')
    if (response.ok) {
      const session = await response.json()
      const user = session && session.user ? session.user : null

      __cache(user)

      return __out(user)
    }

    if (typeof window !== 'undefined') {
      try {
        const cached = window.localStorage.getItem('teleport_auth_user')
        if (cached) {
          return __out(JSON.parse(cached))
        }
      } catch (_e) {}
    }

    return __out(null)
  } catch (err: unknown) {
    if (typeof window !== 'undefined') {
      try {
        const fallback = window.localStorage.getItem('teleport_auth_user')
        if (fallback) {
          return __out(JSON.parse(fallback))
        }
      } catch (_e) {}
    }
    return { user: null, error: (err as Error).message }
  }
}

export const accountGetCurrent: NodeHandlerGenerator = {
  nodeType: 'account-get-current',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_get_current)
  },
}
