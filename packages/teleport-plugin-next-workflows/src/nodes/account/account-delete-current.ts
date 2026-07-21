import { NodeHandlerGenerator, handlerToString } from '../types'

// Terminal client node. The heavy lifting (the multi-statement DB transaction
// that detaches/anonymises orders, deletes the user's personal data, and
// removes the user row, followed by the farewell email) runs server-side in the
// dedicated /api/account/delete-current route — a browser cannot run a DB
// transaction or read email secrets. Once that succeeds, this handler signs the
// user out, clears the cached sign-in info, shows the success notification and
// redirects to the homepage. It must be the last node in its workflow.
async function account_delete_current(config: any, context: Record<string, unknown>) {
  const baseUrl = (context && (context as any).__baseUrl) || ''

  // The route resolves the current user from the NextAuth session cookie, which
  // the browser sends automatically with this same-origin request.
  const response = await fetch(baseUrl + '/api/account/delete-current', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })

  let data: any = {}
  try {
    data = await response.json()
  } catch (_e) {}

  if (!response.ok) {
    throw new Error((data && data.error) || 'Failed to delete account')
  }

  // Client-side teardown — mirror account-logout: sign out via the window bridge
  // session-provider.js publishes (never require('next-auth/react'), which
  // dangles under SWC production chunk-splitting), clear the cached auth user,
  // and notify listeners so the UI updates.
  const nextAuthReact =
    (typeof window !== 'undefined' && (window as any).__teleportNextAuth) || null
  if (nextAuthReact && typeof nextAuthReact.signOut === 'function') {
    try {
      await nextAuthReact.signOut({ redirect: false })
    } catch (_e) {}
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('teleport_auth_user')
    } catch (_e) {}
    window.dispatchEvent(new CustomEvent('teleport:auth-user-changed', { detail: { user: null } }))

    const message =
      (config && config.successMessage) || "Your account has been deleted. We're sad to see you go."
    // Self-contained success notification: the toast DOM does not survive the
    // navigation below, so it is shown first and the redirect is briefly delayed
    // so the farewell message is visible.
    try {
      const win = window as any
      const el = win.document.createElement('div')
      el.textContent = message
      el.setAttribute(
        'style',
        'position:fixed;top:20px;right:20px;z-index:2147483647;max-width:360px;' +
          'background:#16a34a;color:#ffffff;padding:14px 18px;border-radius:10px;' +
          'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
          'font-size:14px;line-height:1.4;box-shadow:0 6px 24px rgba(0,0,0,0.18);'
      )
      win.document.body.appendChild(el)
    } catch (_e) {}

    const redirectTo = (config && config.redirectTo) || '/'
    window.setTimeout(function () {
      window.location.href = redirectTo
    }, 1500)
  }

  return { success: true, __terminal: true }
}

export const accountDeleteCurrent: NodeHandlerGenerator = {
  nodeType: 'account-delete-current',
  executionEnv: 'client',
  isTerminal: true,
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_delete_current)
  },
}
