import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_logout(_config: unknown, _context: Record<string, unknown>) {
  // Read signOut off the window bridge session-provider.js publishes instead of
  // `require('next-auth/react')` — see the account-login handler for the full
  // rationale (avoids the dangling-module "reading 'call'" crash that a
  // re-bundled sync require triggers under SWC production chunk-splitting).
  const nextAuthReact =
    (typeof window !== 'undefined' && (window as any).__teleportNextAuth) || null
  if (!nextAuthReact || typeof nextAuthReact.signOut !== 'function') {
    throw new Error('Authentication is still loading. Please try again in a moment.')
  }
  const signOut = nextAuthReact.signOut

  await signOut({ redirect: false })

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem('teleport_auth_user')
    } catch (_e) {}
    window.dispatchEvent(new CustomEvent('teleport:auth-user-changed', { detail: { user: null } }))
    window.location.href = '/'
  }

  return { success: true }
}

export const accountLogout: NodeHandlerGenerator = {
  nodeType: 'account-logout',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_logout)
  },
}
