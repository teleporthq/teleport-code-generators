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
  // Only 'authenticated' short-circuits. 'unauthenticated' is also what
  // next-auth reports when the provider's fetch FAILED, and treating a
  // transient error as "signed out" would send a signed-in visitor down the
  // guest branch. It falls through to the fetch — which for a guest is the
  // cheap case anyway, since the jwt callback returns before touching the
  // database when there is no token.
  //
  // 'loading' means the provider's FIRST /api/auth/session fetch is still in
  // flight (a click that lands within ~a second of page load). Issuing our own
  // fetch at that moment duplicates the exact request already on the wire —
  // including its jwt-callback user-row read. Instead, briefly poll the bridge
  // snapshot until the in-flight fetch settles; the bounded deadline means a
  // hung provider fetch degrades to today's behaviour (our own fetch) instead
  // of stalling the workflow.
  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).__teleportNextAuth
      let snapshot = bridge && typeof bridge.getSession === 'function' ? bridge.getSession() : null
      if (snapshot && snapshot.status === 'loading') {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          await new Promise(function (resolve) {
            setTimeout(resolve, 50)
          })
          snapshot = bridge.getSession()
          if (!snapshot || snapshot.status !== 'loading') {
            break
          }
        }
      }
      if (snapshot && snapshot.status === 'authenticated') {
        const liveUser = snapshot.session && snapshot.session.user ? snapshot.session.user : null
        if (liveUser) {
          __cache(liveUser)
          ;(window as any).__tqSessionConfirmedSignedOut = false
          return __out(liveUser)
        }
      }
      // The fetch below exists to guard against 'unauthenticated' meaning "the
      // provider's fetch FAILED" rather than "signed out". Once ONE fetch this
      // page load has come back ok with no user, that ambiguity is resolved —
      // repeating the confirmation on every subsequent click only burns a round
      // trip. The memo is a window flag (never storage): a reload starts a
      // fresh page and re-verifies, and it is cleared the moment any live user
      // is observed. It is consulted ONLY when next-auth itself reports
      // 'unauthenticated' — it can never mask a signed-in session, and it is
      // display-plumbing only: every server-side write re-derives identity
      // from the httpOnly session cookie, not from anything cached here.
      if (
        snapshot &&
        snapshot.status === 'unauthenticated' &&
        (window as any).__tqSessionConfirmedSignedOut === true
      ) {
        __cache(null)
        return __out(null)
      }
    } catch (_e) {}
  }

  try {
    const response = await fetch(baseUrl + '/api/auth/session')
    if (response.ok) {
      const session = await response.json()
      const user = session && session.user ? session.user : null

      __cache(user)

      if (typeof window !== 'undefined') {
        try {
          ;(window as any).__tqSessionConfirmedSignedOut = !user
        } catch (_e) {}
      }

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
