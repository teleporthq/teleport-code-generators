import { NodeHandlerGenerator, handlerToString } from '../types'

/**
 * Rebuilds statically generated pages on the published site.
 *
 * This is the OTHER cache a published project serves from. `cache-invalidate`
 * clears the data-API cache; a page built by `getStaticProps` keeps serving the
 * HTML it was built with regardless, until its ISR window expires. So an admin
 * who creates, edits or deletes a row watches the public URL stay wrong for the
 * length of that window. Calling `res.revalidate(path)` re-runs `getStaticProps`
 * for that path immediately.
 *
 * SERVER-classified deliberately, for the same two reasons as
 * `cache-invalidate`: `res.revalidate` only exists inside a server route, and
 * being server-side lands it in the SAME segment as the write it follows, so
 * adding it to a CRUD workflow costs no extra round trip.
 *
 * It reaches the rebuild through the app's own `POST /api/tq-revalidate` rather
 * than by importing anything: node handlers ship as runtime source and are
 * re-bundled by webpack, which rewrites `require(` — so an internal HTTP call is
 * the sanctioned way for a handler to reach server-side machinery, and it is
 * also the only way to get at a `res` object with `revalidate` on it.
 *
 * ⛔ Never mark this node fire-and-forget. Its workflows navigate or refresh a
 * page immediately afterwards, and that reload routinely wins the race against
 * an unawaited rebuild — leaving the visitor looking at the stale page this was
 * meant to replace.
 *
 * ⛔ It also must NEVER return `{ success: false }` or a string `error`. The
 * runtime treats both as FATAL and halts the workflow (`isFatalNodeResult`), so
 * a page that could not be rebuilt would abort an admin's save AFTER the row was
 * already written — no success toast, no navigation, and an error for an action
 * that worked. Outcomes are reported as `revalidated` plus a `warning`, and the
 * page's own ISR window remains the safety net.
 */
async function page_revalidate(config: any, context: Record<string, unknown>) {
  const configured = Array.isArray(config.paths)
    ? config.paths
    : config.paths === undefined || config.paths === null
    ? []
    : [config.paths]

  // One level of flattening: a step that revalidates several rows at once (a
  // bulk delete, say) resolves ONE reference to an array of slugs rather than
  // configuring a path per row.
  const flattened: unknown[] = []
  for (let i = 0; i < configured.length; i++) {
    const entry = configured[i]
    if (Array.isArray(entry)) {
      for (let j = 0; j < entry.length; j++) {
        flattened.push(entry[j])
      }
      continue
    }
    flattened.push(entry)
  }

  const paths: string[] = []
  for (let i = 0; i < flattened.length; i++) {
    const raw = flattened[i]
    if (raw === undefined || raw === null || typeof raw === 'object') {
      continue
    }
    const trimmed = String(raw).trim()
    if (!trimmed) {
      continue
    }
    // `res.revalidate` only accepts a site-root-relative path, and a step whose
    // path came from a database column often holds the bare slug.
    const normalized = trimmed.charAt(0) === '/' ? trimmed : '/' + trimmed
    if (paths.indexOf(normalized) === -1) {
      paths.push(normalized)
    }
  }

  if (!paths.length) {
    return {
      revalidated: [],
      warning: 'No page paths were configured on this step.',
    }
  }

  const baseUrl = (context.__baseUrl as string) || ''
  const __internalHeaders = (context.__internalHeaders as Record<string, string>) || {}
  const __env = (globalThis as any).process && (globalThis as any).process.env
  const secret = __env ? __env.TQ_CACHE_SECRET : ''

  if (!secret) {
    // Reported rather than thrown: the write this follows already succeeded, and
    // the page still refreshes on its own revalidate window.
    return {
      revalidated: [],
      warning:
        'TQ_CACHE_SECRET is not configured, so published pages will refresh on their own schedule.',
    }
  }

  try {
    const response = await fetch(baseUrl + '/api/tq-revalidate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tq-cache-secret': secret,
        ...__internalHeaders,
      },
      body: JSON.stringify({ paths }),
    })

    const data = await response.json()

    if (!response.ok || !data.ok) {
      const warning: string =
        data.error || 'The published pages could not be refreshed; they will refresh on their own.'
      return { revalidated: [], warning }
    }

    const revalidated = Array.isArray(data.revalidated) ? data.revalidated : []
    const failed = Array.isArray(data.failed) ? data.failed : []

    if (failed.length) {
      return {
        revalidated,
        warning:
          'Some pages could not be refreshed and will refresh on their own: ' + failed.join(', '),
      }
    }

    return { revalidated }
  } catch (err: unknown) {
    return { revalidated: [], warning: (err as Error).message }
  }
}

export const pageRevalidate: NodeHandlerGenerator = {
  nodeType: 'page-revalidate',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(page_revalidate)
  },
}
