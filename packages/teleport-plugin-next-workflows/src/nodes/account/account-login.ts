import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_login(config: any, context: Record<string, unknown>) {
  const email = config.email
  const password = config.password

  if (!email || !password) {
    throw new Error('Email and password are required')
  }

  // Read signIn off the window bridge that session-provider.js publishes,
  // instead of `require('next-auth/react')` here. This handler is emitted via
  // fn.toString() and re-bundled inside the generated project; a sync CJS
  // `require('next-auth/react')` resolved to a separate module instance from
  // the ESM copy session-provider imports, and SWC production chunk-splitting
  // could leave that CJS module in a chunk not loaded on the auth page —
  // a dangling reference that threw "Cannot read properties of undefined
  // (reading 'call')" the moment Sign In ran. `window.__teleportNextAuth` is
  // populated at module-eval time by session-provider (rendered in _app on
  // every page) from its already-bundled ESM next-auth/react, so signIn is
  // always present and no fragile require/import lives in this handler.
  const nextAuthReact =
    (typeof window !== 'undefined' && (window as any).__teleportNextAuth) || null
  if (!nextAuthReact || typeof nextAuthReact.signIn !== 'function') {
    throw new Error('Authentication is still loading. Please try again in a moment.')
  }
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

  const __nodeRequire = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require);
  const { verifyPassword } = __nodeRequire('../../../utils/auth/hash-password');
  const authUtils = __nodeRequire('../../../utils/auth/auth-options');

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
