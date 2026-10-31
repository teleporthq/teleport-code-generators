import { NodeHandlerGenerator, handlerToString } from '../types'

// Client node. It sends only the address the visitor typed to the dedicated
// /api/auth/forgot-password route, which decides everything else on the
// server: whether the address has an account, the link's token (minted there,
// stored hashed), the page it opens and the email itself (provider, sender and
// template baked from this node's config at generation). The route answers the
// same whether the address has an account or not, so this node reports success
// for a well-formed request unless the site could not keep a link, for any
// address.
async function account_request_password_reset(config: any, context: Record<string, unknown>) {
  const email = config && typeof config.email === 'string' ? config.email.trim() : ''
  if (!email) {
    throw new Error('Email is required')
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  // The page's language rides along so the email is sent in it.
  const requestHeaders: any = { 'Content-Type': 'application/json' }
  const runLocale = context && (context as any).__locale
  if (typeof runLocale === 'string' && runLocale) {
    requestHeaders['x-teleport-locale'] = runLocale
  }
  const response = await fetch(baseUrl + '/api/auth/forgot-password', {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify({ email }),
  })

  let data: any = {}
  try {
    data = await response.json()
  } catch (_e) {}

  if (!response.ok) {
    throw new Error((data && data.error) || 'We could not send the reset link. Please try again.')
  }

  return { success: true, message: (data && data.message) || '' }
}

export const accountRequestPasswordReset: NodeHandlerGenerator = {
  nodeType: 'account-request-password-reset',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(account_request_password_reset)
  },
}
