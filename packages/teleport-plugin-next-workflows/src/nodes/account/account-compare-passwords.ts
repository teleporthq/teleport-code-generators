import { NodeHandlerGenerator, handlerToString } from '../types'

async function account_compare_passwords(config: any, context: Record<string, unknown>) {
  const password = config.password
  const hash = config.hash

  if (!password && password !== '') {
    throw new Error('Password is required')
  }

  if (!hash) {
    throw new Error('Hash is required')
  }

  const passwordStr = String(password)
  const hashStr = String(hash)

  if (passwordStr.length > 1000) {
    throw new Error('Password exceeds maximum length')
  }

  if (hashStr.length === 0) {
    throw new Error('Hash cannot be empty')
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
  const isMatch = bcrypt.compareSync(sha, hashStr)

  // `isMatch` is the contract key; `match` is a defensive alias for any
  // workflow that reads `.match` (the delete-account template did).
  return { isMatch, match: isMatch }
}

export const accountComparePasswords: NodeHandlerGenerator = {
  nodeType: 'account-compare-passwords',
  executionEnv: 'server',
  dependencies: {
    bcryptjs: '^2.4.3',
  },
  generateHandler(): string {
    return handlerToString(account_compare_passwords)
  },
}
