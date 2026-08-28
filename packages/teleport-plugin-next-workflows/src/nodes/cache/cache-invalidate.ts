import { NodeHandlerGenerator, handlerToString } from '../types'

/**
 * Clears every cached entry in a scope — including the array-mapper caches that
 * the storefront serves its lists from.
 *
 * SERVER-classified deliberately. Its job is to bump the shared version row, and
 * being server-side means it lands in the SAME segment as the data write it
 * follows, so adding it to a CRUD workflow costs no extra round trip.
 *
 * It reaches the shared version through the app's own
 * `POST /api/tq-cache/invalidate` rather than by importing the cache runtime:
 * node handlers ship as runtime source and are re-bundled by webpack, which
 * rewrites `require(` — so an internal HTTP call is the sanctioned way for a
 * handler to reach server-side machinery (the same shape every `data-*` node
 * uses to reach `/api/data`).
 *
 * ⛔ Never mark this node fire-and-forget. Nothing reads its output, which makes
 * it look like free latency to reclaim — but the workflows that use it navigate
 * or refresh a page immediately afterwards, and that reload routinely wins the
 * race and re-reads the very cache this was meant to clear.
 *
 * ⛔ It also must NEVER return `{ success: false }` or a string `error`. The
 * runtime treats both as FATAL and halts the workflow (`isFatalNodeResult`), so
 * a cache that could not be cleared would abort an admin's save AFTER the row
 * was already written — no success toast, no navigation, and an error for an
 * action that worked. Outcomes are reported as `cleared` plus a `warning`.
 */
async function cache_invalidate(config: any, context: Record<string, unknown>) {
  const scope = config.scope

  if (!scope) {
    return { cleared: false, scope, warning: 'No cache scope was configured on this step.' }
  }

  const baseUrl = (context.__baseUrl as string) || ''
  const __internalHeaders = (context.__internalHeaders as Record<string, string>) || {}
  const __env = (globalThis as any).process && (globalThis as any).process.env
  const secret = __env ? __env.TQ_CACHE_SECRET : ''

  if (!secret) {
    // Reported rather than thrown: the write this follows already succeeded, and
    // stale cache entries still expire on their TTL.
    return {
      cleared: false,
      scope,
      warning: 'TQ_CACHE_SECRET is not configured, so cached entries will expire on their own.',
    }
  }

  try {
    const response = await fetch(baseUrl + '/api/tq-cache/invalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tq-cache-secret': secret,
        ...__internalHeaders,
      },
      body: JSON.stringify({ scopes: [scope] }),
    })

    const data = await response.json()

    if (!response.ok || !data.ok) {
      return {
        cleared: false,
        scope,
        warning: data.error || 'The cache could not be cleared; entries will expire on their own.',
      }
    }

    // `localOnly` means the in-process purge landed but the shared version did
    // not move, so other instances still hold their entries.
    if (data.localOnly) {
      return {
        cleared: false,
        scope,
        warning:
          data.error || 'Only this server was cleared; other servers will expire on their own.',
      }
    }

    return { cleared: true, scope, version: data.versions ? data.versions[scope] : undefined }
  } catch (err: unknown) {
    return { cleared: false, scope, warning: (err as Error).message }
  }
}

export const cacheInvalidate: NodeHandlerGenerator = {
  nodeType: 'cache-invalidate',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(cache_invalidate)
  },
}
