import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_hash_password(config: any, context: Record<string, unknown>) {
  const password = config.password
  const saltRounds = config.saltRounds !== undefined ? Number(config.saltRounds) : 12

  if (!password && password !== '') {
    throw new Error('Password is required')
  }

  const passwordStr = String(password)

  if (passwordStr.length === 0) {
    throw new Error('Password cannot be empty')
  }

  // The password a site accepts (the sign-up and reset routes apply the same).
  if (passwordStr.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  if (
    passwordStr.length > 1000 ||
    (globalThis as any).Buffer.byteLength(passwordStr, 'utf8') > 128
  ) {
    throw new Error('Password is too long (at most 128 bytes)')
  }

  if (!Number.isInteger(saltRounds) || saltRounds < 4 || saltRounds > 31) {
    throw new Error('Salt rounds must be an integer between 4 and 31')
  }

  // The GUI bundles these handlers through webpack and serializes them via
  // fn.toString(); a bare `require` is rewritten to the browser-only
  // `__webpack_require__` and a bare `process` to an undefined symbol — both
  // crash on the Vercel Node runtime. Use webpack's `__non_webpack_require__`
  // escape hatch (absent in tsc/dist + the generated project, so we fall back
  // to the real `require`) and member-access `globalThis.process`, which
  // webpack leaves untouched. See payment-charge-user.ts for details.
  const __nodeRequire =
    typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
  const bcrypt = __nodeRequire('bcryptjs')
  const crypto = __nodeRequire('crypto')

  // The project's own pepper (AUTH_PEPPER_SECRET) when the deployment has one,
  // else the one every earlier hash used (AUTH_PEPPER) — as utils/auth/hash-password.
  const env = (globalThis as any).process.env
  const secretPepper =
    typeof env.AUTH_PEPPER_SECRET === 'string' &&
    env.AUTH_PEPPER_SECRET.indexOf('teleporthq.secrets.') !== 0
      ? env.AUTH_PEPPER_SECRET
      : ''
  const PEPPER = secretPepper || env.AUTH_PEPPER || ''
  const sha = crypto
    .createHash('sha256')
    .update(passwordStr + PEPPER)
    .digest('base64')
  const hash = bcrypt.hashSync(sha, saltRounds)

  return { hash }
}

export const accountHashPassword: NodeHandlerGenerator = {
  nodeType: 'account-hash-password',
  executionEnv: 'server',
  dependencies: {
    bcryptjs: '^2.4.3',
  },
  generateHandler(): string {
    return handlerToString(account_hash_password)
  },
}
