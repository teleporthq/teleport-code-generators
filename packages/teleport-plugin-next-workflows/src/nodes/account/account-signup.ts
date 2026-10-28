import { NodeHandlerGenerator, ServerHandlerOptions, handlerToString } from '../types'
import { AccountFields } from '@teleporthq/teleport-shared'
import { generateAccountEventRecorder, SIGNUP_OWN_COLUMNS } from '../../auth-generator'

async function account_signup(config: any, context: Record<string, unknown>) {
  const email = config.email
  const password = config.password
  const name = config.name || ''

  if (!email || !password) {
    throw new Error('Email and password are required')
  }

  const bodyObj: any = { email, password, name }
  // Skip auth fields AND the welcome-email config (emailProvider/from/apiKey/
  // subject/body/…): those are consumed by the generated signup route to send
  // the welcome email — they must never be forwarded (they'd be inserted as
  // bogus user columns) nor shipped/echoed from the client.
  const skipKeys: any = {
    email: true,
    password: true,
    name: true,
    emailProvider: true,
    from: true,
    fromName: true,
    apiKey: true,
    serverToken: true,
    subject: true,
    body: true,
    bodySource: true,
    bodyComponentId: true,
    bodyTemplatePurpose: true,
    templateParams: true,
    localizedTemplates: true,
  }
  const configKeys = Object.keys(config)
  for (let i = 0; i < configKeys.length; i++) {
    if (!skipKeys[configKeys[i]]) {
      bodyObj[configKeys[i]] = config[configKeys[i]]
    }
  }
  // The consent box as the route reads it: 'true' when ticked (a checked
  // box, 'true', or a form's 'on'), else 'false'.
  if (Object.prototype.hasOwnProperty.call(config, 'marketing_consent')) {
    const consent = config.marketing_consent
    bodyObj.marketing_consent =
      consent === true || consent === 'true' || consent === 'on' ? 'true' : 'false'
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  // The language of the page the visitor signs up from, so the route sends
  // the welcome email in it. The runtime puts it on the context (see
  // buildContext); the route falls back to the request when it is absent.
  const signupHeaders: any = { 'Content-Type': 'application/json' }
  const runLocale = context && (context as any).__locale
  if (typeof runLocale === 'string' && runLocale) {
    signupHeaders['x-teleport-locale'] = runLocale
  }
  const response = await fetch(baseUrl + '/api/auth/signup', {
    method: 'POST',
    headers: signupHeaders,
    body: JSON.stringify(bodyObj),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error || 'Signup failed')
  }

  // The route answers an address that already has an account exactly like a
  // new one (its owner is told by email), so only a session proves the visitor
  // is signed in: nothing from the answer is taken for the user.
  let user = null

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

  // The sign-up was answered but no session followed: the address was already
  // known (an account, or a subscriber or guest without a password), and the
  // route emailed it what to do. One message for every case, so the page never
  // tells which.
  if (!user) {
    throw new Error('Check your inbox — we sent an email about this address.')
  }

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('teleport_auth_user', JSON.stringify(user))
    } catch (_e) {}
    window.dispatchEvent(new CustomEvent('teleport:auth-user-changed', { detail: { user } }))
    // Growth analytics: a sign-up is an outcome. Reported BEFORE the redirect
    // below tears the page down (the tracker beacons it at once).
    try {
      const tpAnalytics = (window as any).tpAnalytics
      if (tpAnalytics && typeof tpAnalytics.track === 'function') {
        tpAnalytics.track('signup', {})
      }
    } catch (_e) {}
    // Back to the page the visitor was sent to sign in from, else the home
    // page — in the language they signed up from.
    window.location.href = __workflowUtils.signedInDestination(runLocale)
  }

  // Contract exposes user fields flat (id, email, name, ...) plus `user`/`success`.
  // Built without Object.assign/spread — this handler is .toString()'d and
  // bundled, where down-levelled spread would reference a missing tslib helper.
  const __out: any = {}
  if (user) {
    const __k = Object.keys(user)
    for (let __i = 0; __i < __k.length; __i++) {
      __out[__k[__i]] = (user as any)[__k[__i]]
    }
  }
  __out.user = user || null
  __out.success = true
  return __out
}

// The config keys a server-run sign-up never copies onto the account.
const serverSignupReservedKeys = (): Record<string, number> => {
  const keys: Record<string, number> = {}
  for (const key of ['email', 'password', 'name', 'role', ...SIGNUP_OWN_COLUMNS]) {
    keys[key] = 1
  }
  return keys
}

export const accountSignup: NodeHandlerGenerator = {
  nodeType: 'account-signup',
  executionEnv: 'client',
  dependencies: {
    'next-auth': '4.24.15',
  },
  generateHandler(): string {
    return handlerToString(account_signup)
  },
  generateServerHandler(options: ServerHandlerOptions = {}): string {
    // A project with automations records the new account, like the signup
    // route does (see generateSignupRouteFile).
    const recordsSignup = options.withAutomations === true
    const recorder = recordsSignup
      ? generateAccountEventRecorder({
          relativePrefix: options.relativePrefix || '../../..',
          logTag: '[account-signup]',
        })
          .split('\n')
          .map((line) => (line ? '  ' + line : line))
          .join('\n')
      : ''
    return `async function account_signup(config, context) {${recorder}
  const email = config.email;
  const password = config.password;
  const name = config.name || '';

  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const __nodeRequire = (typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require);
  const hashPassword = __nodeRequire('../../../utils/auth/hash-password');
  const authUtils = __nodeRequire('../../../utils/auth/auth-options');

  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  const policyError = hashPassword.passwordPolicyError(String(password));
  if (policyError) {
    throw new Error(policyError);
  }

  // In any letter case, as the sign-up route looks it up. An address the site
  // already knows (an account, a subscriber, a guest) is refused with one
  // message, which never tells which it is; its row is never taken.
  const existing = await authUtils.findSignupUserByEmail(email);
  if (existing) {
    throw new Error('This email cannot be used to create an account here.');
  }

  const hashedPassword = hashPassword(password);
  const userData = {
    name: name || null,
    email: email,
    password: hashedPassword,
    role: 'user',
  };
  // The columns the sign-up sets itself (where the person came from, their
  // consent) are never taken from the config as they are.
  const reservedKeys = ${JSON.stringify(serverSignupReservedKeys())};
  // A column that grants something (a role, an admin or staff flag, a verified
  // email, credit, a plan, an entitlement) is the server's, in any spelling.
  const privilegedKey = ${AccountFields.PRIVILEGED_ACCOUNT_FIELD_PATTERN.toString()};
  const configKeys = Object.keys(config);
  for (let i = 0; i < configKeys.length; i++) {
    const normalizedKey = configKeys[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!reservedKeys[configKeys[i]] && !privilegedKey.test(normalizedKey)) {
      userData[configKeys[i]] = config[configKeys[i]];
    }
  }
  // Where the person came from, and their consent as given (a ticked box:
  // true, 'true' or 'on'), like the sign-up route. Never assumed.
  const consent = config.marketing_consent;
  userData.source = 'signup';
  userData.marketing_consent = consent === true || consent === 'true' || consent === 'on';

  const newUser = await authUtils.createUser(userData);

  if (!newUser) {
    throw new Error('Failed to create user');
  }
${
  recordsSignup
    ? `  // The account exists: record it for the automations.
  await recordAccountEvent('user-signed-up', newUser, 'signup', context && context.__request);
`
    : ''
}
  const __su = authUtils.sanitizeUser(newUser);
  return Object.assign({}, __su || {}, { user: __su, success: true });
}`
  },
}
