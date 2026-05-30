import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_signup(config: any, context: Record<string, unknown>) {
  const email = config.email
  const password = config.password
  const name = config.name || ''

  if (!email || !password) {
    throw new Error('Email and password are required')
  }

  const bodyObj: any = { email, password, name }
  const skipKeys: any = { email: true, password: true, name: true }
  const configKeys = Object.keys(config)
  for (let i = 0; i < configKeys.length; i++) {
    if (!skipKeys[configKeys[i]]) {
      bodyObj[configKeys[i]] = config[configKeys[i]]
    }
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  const response = await fetch(baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyObj),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Signup failed')
  }

  let user = data.user || null

  try {
    // Read signIn off the window bridge session-provider.js publishes instead
    // of `require('next-auth/react')` — see the account-login handler for the
    // full rationale (avoids the dangling-module "reading 'call'" crash that a
    // re-bundled sync require triggers under SWC production chunk-splitting).
    const nextAuthReact =
      (typeof window !== 'undefined' && (window as any).__teleportNextAuth) || null
    if (!nextAuthReact || typeof nextAuthReact.signIn !== 'function') {
      throw new Error('Authentication is still loading. Please try again in a moment.')
    }
    const signIn = nextAuthReact.signIn
    const loginResult = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (!loginResult || !loginResult.error) {
      try {
        const sessionRes = await fetch(baseUrl + '/api/auth/session')
        if (sessionRes.ok) {
          const session = await sessionRes.json()
          if (session && session.user) {
            user = session.user
          }
        }
      } catch (_e) {}
    }
  } catch (_loginErr) {}

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

export const accountSignup: NodeHandlerGenerator = {
  nodeType: 'account-signup',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '^4.24.0',
  },
  generateHandler(): string {
    return handlerToString(account_signup)
  },
  generateServerHandler(): string {
    return `async function account_signup(config, context) {
  const email = config.email;
  const password = config.password;
  const name = config.name || '';

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const hashPassword = require('../../../utils/auth/hash-password');
  const authUtils = require('../../../utils/auth/auth-options');

  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const exists = await authUtils.userExistsByEmail(email);
  if (exists) {
    throw new Error('User with this email already exists');
  }

  const hashedPassword = hashPassword(password);
  const userData = {
    name: name || null,
    email: email,
    password: hashedPassword,
    role: 'user',
  };
  const reservedKeys = { email: 1, password: 1, name: 1, role: 1 };
  const configKeys = Object.keys(config);
  for (let i = 0; i < configKeys.length; i++) {
    if (!reservedKeys[configKeys[i]]) {
      userData[configKeys[i]] = config[configKeys[i]];
    }
  }

  const newUser = await authUtils.createUser(userData);

  if (!newUser) {
    throw new Error('Failed to create user');
  }

  return {
    user: authUtils.sanitizeUser(newUser),
    success: true,
  };
}`
  },
}
