import { NodeHandlerGenerator, handlerToString } from '../types'

// Client node. It hands the reset link's token (from the page URL) and the new
// password to the dedicated /api/auth/reset-password route, which spends the
// link and sets the password in one server-side statement. With `checkOnly` it
// only asks whether the link still works (the reset page's load check).
// `{ valid, changed }`: a link that is expired, spent or unknown is
// `{ valid: false, changed: false }`, never an error.
async function account_reset_password(config: any, context: Record<string, unknown>) {
  const token = config && config.token != null ? String(config.token).trim() : ''
  const checkOnly = !!config && (config.checkOnly === true || config.checkOnly === 'true')
  if (!token) {
    return { valid: false, changed: false }
  }
  const password = config && config.password != null ? String(config.password) : ''
  if (!checkOnly && !password) {
    throw new Error('Password is required')
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  const response = await fetch(baseUrl + '/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(checkOnly ? { token, checkOnly: true } : { token, password }),
  })

  let data: any = {}
  try {
    data = await response.json()
  } catch (_e) {}

  if (!response.ok) {
    throw new Error((data && data.error) || 'We could not reset the password. Please try again.')
  }

  return { valid: !!data && data.valid === true, changed: !!data && data.changed === true }
}

export const accountResetPassword: NodeHandlerGenerator = {
  nodeType: 'account-reset-password',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(account_reset_password)
  },
}
