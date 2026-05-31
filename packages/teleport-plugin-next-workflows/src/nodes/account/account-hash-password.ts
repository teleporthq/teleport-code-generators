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

  if (passwordStr.length > 1000) {
    throw new Error('Password exceeds maximum length')
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

  const PEPPER = (globalThis as any).process.env.AUTH_PEPPER || ''
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
