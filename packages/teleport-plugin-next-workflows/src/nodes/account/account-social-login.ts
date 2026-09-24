import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_social_login(config: any, context: Record<string, unknown>) {
  const provider = config.provider

  if (!provider) {
    throw new Error('Provider is required')
  }

  // Where the provider sends the visitor back to, in the language they started
  // the sign-in from (see buildContext for how the run learns it).
  const callbackUrl = __workflowUtils.localizeHref(
    config.callbackUrl || '/',
    context && (context as any).__locale
  )

  // Read signIn off the window bridge session-provider.js publishes instead of
  // `require('next-auth/react')` — see the account-login handler for the full
  // rationale (avoids the dangling-module "reading 'call'" crash that a
  // re-bundled sync require triggers under SWC production chunk-splitting).
  const nextAuthReact =
    (typeof window !== 'undefined' && (window as any).__teleportNextAuth) || null
  if (!nextAuthReact || typeof nextAuthReact.signIn !== 'function') {
    throw new Error('Authentication is still loading. Please try again in a moment.')
  }
  const signIn = nextAuthReact.signIn

  await signIn(provider, { callbackUrl })

  return { success: true, redirected: true, __terminal: true }
}

export const accountSocialLogin: NodeHandlerGenerator = {
  nodeType: 'account-social-login',
  executionEnv: 'client',
  isTerminal: true,
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_social_login)
  },
}
