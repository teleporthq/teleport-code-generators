import { NodeHandlerGenerator, handlerToString } from '../types'

// Client node, for the newsletter's confirm page. It hands the link's token
// (from the page URL) to the dedicated /api/newsletter/confirm route, which
// checks it and subscribes the person on the server. `{ ok, email? }`: a link
// that is expired or not one is `{ ok: false }`, never an error.
async function newsletter_confirm(config: any, context: Record<string, unknown>) {
  const token = config && config.token != null ? String(config.token).trim() : ''
  if (!token) {
    return { ok: false }
  }

  const baseUrl = (context && (context as any).__baseUrl) || ''
  const response = await fetch(baseUrl + '/api/newsletter/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  })

  let data: any = {}
  try {
    data = await response.json()
  } catch (_e) {}

  if (!response.ok) {
    throw new Error(
      (data && data.error) || 'We could not confirm the subscription. Please try again.'
    )
  }

  const result: any = { ok: !!data && data.ok === true }
  if (result.ok && typeof data.email === 'string') {
    result.email = data.email
  }
  return result
}

export const newsletterConfirm: NodeHandlerGenerator = {
  nodeType: 'newsletter-confirm',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(newsletter_confirm)
  },
}
