import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_login(config: any, context: Record<string, unknown>) {
  const email = config.email
  const password = config.password

  if (!email || !password) {
    throw new Error('Email and password are required')
  }

  const nextAuthReact = require('next-auth/react')
  const signIn = nextAuthReact.signIn

  const result = await signIn('credentials', {
    email,
    password,
    redirect: false,
  })

  if (result && result.error) {
    throw new Error(result.error)
  }

  let user = null
  try {
    const baseUrl = (context && (context as any).__baseUrl) || ''
    const sessionRes = await fetch(baseUrl + '/api/auth/session')
    if (sessionRes.ok) {
      const session = await sessionRes.json()
      user = session && session.user ? session.user : null
    }
  } catch (_e) {}

  if (typeof window !== 'undefined') {
    if (user) {
      try {
        window.localStorage.setItem('teleport_auth_user', JSON.stringify(user))
      } catch (_e) {}
    }
    window.dispatchEvent(new CustomEvent('teleport:auth-user-changed', { detail: { user } }))
    window.location.href = '/'
  }

  return { user, success: true }
}

export const accountLogin: NodeHandlerGenerator = {
  nodeType: 'account-login',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_login)
  },
  generateServerHandler(): string {
    return `async function account_login(config, context) {
  const email = config.email;
  const password = config.password;

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const { verifyPassword } = require('../../../utils/auth/hash-password');
  const authUtils = require('../../../utils/auth/auth-options');

  const user = await authUtils.findUserByEmail(email);
  if (!user) {
    throw new Error('Invalid email or password');
  }

  if (!verifyPassword(password, user.password)) {
    throw new Error('Invalid email or password');
  }

  return {
    user: authUtils.sanitizeUser(user),
    success: true,
  };
}`
  },
}
