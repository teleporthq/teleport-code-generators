import { NodeHandlerGenerator, handlerToString } from '../types'

// Re-reads the signed-in user from the server and republishes it to everything
// on the page that renders profile data.
//
// Why a dedicated node: the session is a JWT, and the generated `jwt` callback
// only re-reads the `users` row once per USER_REFRESH_INTERVAL_MS (see
// auth-generator) because that read is the expensive part of /api/auth/session.
// The one documented escape hatch is `useSession().update()`, which makes
// next-auth pass `trigger: 'update'` to the callback and bypass the interval —
// but nothing ever called it. So after a profile save the session kept serving
// the PREVIOUS name/image: `account-get-current` reads it, GlobalContext seeds
// `currentUser` from it on every page load, and the account-menu avatar binds
// straight to `currentUser.image`. Saving a new photo appeared to do nothing.
//
// The three things this node has to do, in order:
//   1. `update()` — forces the server to re-issue the session cookie from the
//      current database row.
//   2. mirror the fresh user into `teleport_auth_user`, the localStorage copy
//      `account-get-current` falls back to when the session endpoint is
//      unreachable; leaving the old copy there would resurrect the stale photo.
//   3. dispatch `teleport:auth-user-changed`, which is the ONLY thing
//      GlobalContext listens to after its initial fetch — without it
//      `currentUser` (and the avatar bound to it) stays on the old value even
//      though the session itself is now correct.
//
// Never returns a string `error` key: `isFatalNodeResult` treats that as a
// thrown node and would route a successful save into the error handler. A
// session that could not be refreshed is reported as `refreshed: false` and the
// workflow carries on — the optimistic global-state writes the account form
// performs before this node keep the UI correct in the meantime, and the
// interval refresh reconciles the session on its own shortly after.
async function account_refresh_session(_config: unknown, _context: Record<string, unknown>) {
  // Output contract mirrors `account-get-current`: the user's fields flat, plus
  // a `user` object for bindings that read `.user`. Built without
  // spread/Object.assign — this handler ships through fn.toString() into a
  // bundle where a down-levelled spread would reference a missing tslib helper.
  const __out = (sessionUser: any, refreshed: boolean) => {
    const out: any = {}
    if (sessionUser) {
      const keys = Object.keys(sessionUser)
      for (let i = 0; i < keys.length; i++) {
        out[keys[i]] = sessionUser[keys[i]]
      }
    }
    out.user = sessionUser || null
    out.refreshed = refreshed
    return out
  }

  if (typeof window === 'undefined') {
    return __out(null, false)
  }

  const bridge = (window as any).__teleportNextAuth
  if (!bridge || typeof bridge.refreshSession !== 'function') {
    return __out(null, false)
  }

  let session: any = null
  try {
    session = await bridge.refreshSession()
  } catch (_e) {
    return __out(null, false)
  }

  const user = session && session.user ? session.user : null
  // `update()` resolves to undefined while the provider is still loading, and a
  // signed-out session has no user. Publishing either as `{ user: null }` would
  // make GlobalContext's listener call setCurrentUser(null) — signing the
  // visitor out of the UI right after a successful save.
  if (!user) {
    return __out(null, false)
  }

  try {
    window.localStorage.setItem('teleport_auth_user', JSON.stringify(user))
  } catch (_e) {}
  try {
    ;(window as any).__tqSessionConfirmedSignedOut = false
  } catch (_e) {}

  window.dispatchEvent(new CustomEvent('teleport:auth-user-changed', { detail: { user } }))

  return __out(user, true)
}

export const accountRefreshSession: NodeHandlerGenerator = {
  nodeType: 'account-refresh-session',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_refresh_session)
  },
}
