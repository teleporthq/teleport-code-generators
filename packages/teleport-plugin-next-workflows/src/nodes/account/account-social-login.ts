import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_social_login(config: any, _context: Record<string, unknown>) {
  const provider = config.provider

  if (!provider) {
    throw new Error('Provider is required')
  }

  const callbackUrl = config.callbackUrl || '/'

  const nextAuthReact = require('next-auth/react')
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
