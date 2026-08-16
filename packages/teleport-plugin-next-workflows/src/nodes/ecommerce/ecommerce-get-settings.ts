import { NodeHandlerGenerator, handlerToString } from '../types'

// CLIENT handler. The /api/ecommerce/settings route returns a literal baked at
// generation time (see teleport-project-generator-next's
// generateEcommerceSettingsApiRoute) — within a deployment it can never return
// anything else. Paying a server round trip for it on every add-to-cart /
// cart-increment click was pure latency, and because this node was classified
// `server` it also SPLIT the surrounding workflow into extra server segments
// (one HTTP round trip each). The generated ecommerce-context module publishes
// the SAME payload on `window.__teleportEcommerceSettings` at module-eval time
// (before any click can run a workflow), so the common path is a synchronous
// read. The fetch fallback covers projects whose context file predates the
// baked global; a successful response is memoized for the page's lifetime —
// the endpoint is immutable within a deployment, so this can never go stale.
async function ecommerce_get_settings(_config: unknown, context: Record<string, unknown>) {
  const baseUrl = (context && (context as any).__baseUrl) || ''

  if (typeof window !== 'undefined') {
    try {
      const baked = (window as any).__teleportEcommerceSettings
      if (baked && typeof baked === 'object') {
        return baked
      }
      const memoized = (window as any).__teleportEcommerceSettingsFetched
      if (memoized && typeof memoized === 'object') {
        return memoized
      }
    } catch (_e) {}
  }

  try {
    const response = await fetch(baseUrl + '/api/ecommerce/settings', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return { error: 'Failed to load e-commerce settings' }
    }

    const settings = await response.json()
    if (typeof window !== 'undefined' && settings && typeof settings === 'object') {
      try {
        ;(window as any).__teleportEcommerceSettingsFetched = settings
      } catch (_e) {}
    }
    return settings
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}

// SERVER handler — used by contexts that execute every node server-side
// (cron and webhook API routes, where no window exists). Same fetch the old
// server-classified handler performed.
async function ecommerce_settings_server_fetch(_config: unknown, context: Record<string, unknown>) {
  const baseUrl = (context && (context as any).__baseUrl) || ''
  try {
    const response = await fetch(baseUrl + '/api/ecommerce/settings', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      return { error: 'Failed to load e-commerce settings' }
    }

    return await response.json()
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}

export const ecommerceGetSettings: NodeHandlerGenerator = {
  nodeType: 'ecommerce-get-settings',
  // Client: the settings payload is public, baked into the deployment, and
  // already shipped to the browser — keeping this node server-side only
  // fragmented workflows into extra blocking round trips.
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(ecommerce_get_settings)
  },
  generateServerHandler(): string {
    return handlerToString(ecommerce_settings_server_fetch)
  },
}
