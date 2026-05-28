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

  const bcrypt = require('bcryptjs')
  const crypto = require('crypto')

  const PEPPER = process.env.AUTH_PEPPER || ''
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
