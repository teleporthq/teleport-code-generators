import { NodeHandlerGenerator, handlerToString } from '../types'

// Client node, for the newsletter's unsubscribe page. It hands the link's
// token (from the page URL) to the dedicated /api/newsletter/unsubscribe
// route, which checks it and takes the person off the list on the server
// (idempotent). `{ ok, email? }`: a link that is not one is `{ ok: false }`,
// never an error; `email` lets the page offer to subscribe again.
async function newsletter_unsubscribe(config: any, context: Record<string, unknown>) {
  const token = config && config.token != null ? String(config.token).trim() : ''
  if (!token) {
    return { ok: false }
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  const response = await fetch(baseUrl + '/api/newsletter/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  let data: any = {}
  try {
    data = await response.json()
  } catch (_e) {}

  if (!response.ok) {
    throw new Error((data && data.error) || 'We could not unsubscribe you. Please try again.')
  }

  const result: any = { ok: !!data && data.ok === true }
  if (result.ok && typeof data.email === 'string') {
    result.email = data.email
  }
  return result
}

export const newsletterUnsubscribe: NodeHandlerGenerator = {
  nodeType: 'newsletter-unsubscribe',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(newsletter_unsubscribe)
  },
}
