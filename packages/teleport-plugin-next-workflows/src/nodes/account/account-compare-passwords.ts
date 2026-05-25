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

  const bcrypt = require('bcryptjs')
  const crypto = require('crypto')

  const PEPPER = process.env.AUTH_PEPPER || ''
  const sha = crypto
    .createHash('sha256')
    .update(passwordStr + PEPPER)
    .digest('base64')
  const isMatch = bcrypt.compareSync(sha, hashStr)

  return { isMatch }
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
