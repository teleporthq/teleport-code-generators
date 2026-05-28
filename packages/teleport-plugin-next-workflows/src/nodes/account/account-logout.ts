import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_logout(_config: unknown, _context: Record<string, unknown>) {
  const nextAuthReact = require('next-auth/react')
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
