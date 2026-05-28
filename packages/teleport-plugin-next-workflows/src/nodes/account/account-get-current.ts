import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_get_current(_config: unknown, context: Record<string, unknown>) {
  const baseUrl = (context && (context as any).__baseUrl) || ''
  try {
    const response = await fetch(baseUrl + '/api/auth/session')
    if (response.ok) {
      const session = await response.json()
      const user = session && session.user ? session.user : null

      if (typeof window !== 'undefined') {
        try {
          if (user) {
            window.localStorage.setItem('teleport_auth_user', JSON.stringify(user))
          } else {
            window.localStorage.removeItem('teleport_auth_user')
          }
        } catch (_e) {}
      }

      return { user }
    }

    if (typeof window !== 'undefined') {
      try {
        const cached = window.localStorage.getItem('teleport_auth_user')
        if (cached) {
          return { user: JSON.parse(cached) }
        }
      } catch (_e) {}
    }

    return { user: null }
  } catch (err: unknown) {
    if (typeof window !== 'undefined') {
      try {
        const fallback = window.localStorage.getItem('teleport_auth_user')
        if (fallback) {
          return { user: JSON.parse(fallback) }
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
