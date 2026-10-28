import { securityRuntimeSpecifier } from './security-runtime'
import { WorkflowSegment } from './types'
import { NEWSLETTER_VISITOR_LIMIT, NEWSLETTER_VISITOR_SCOPE } from './newsletter/newsletter-scope'

/**
 * A step any visitor may run, but not without end: a guest booking (which
 * takes a place in the calendar and emails a confirmation), a newsletter
 * signup (which adds an address to the merchant's audience). The feature that
 * builds such a step declares how often one visitor may run it, on the step:
 *
 *   config.visitorLimit = { limit: 10, windowSeconds: 3600 }                   // 429 past the limit
 *   config.visitorLimit = { limit: 5, windowSeconds: 3600, onLimit: 'skip' }   // the step quietly does nothing
 *   config.visitorLimit = { …, scope: 'newsletter-signup' }                    // one budget for every such step
 *
 * Without `scope` the budget is the step's own (`workflow-step:<node id>`).
 * With one, every step that names the same scope shares one budget per
 * visitor (`visitor-limit:<scope>`): two signup blocks, or two booking pages,
 * do not give a visitor twice the signups or bookings.
 *
 * The segment route that runs the step counts every request it answers for
 * the visitor (IPv6 by its /64), in the app's database through the shared
 * security runtime, BEFORE any step of the segment runs — so the count cannot
 * be dodged by calling the route directly or by marking the step skipped.
 * This deployment's own server code (the internal-call token) is not counted.
 *
 * ⛔ So a declared limit holds only in a route a BROWSER calls: a limited step
 * inside a custom node that another server segment runs with the internal
 * token is not counted there. Declare the limit on the step the visitor's
 * request reaches (the feature builders do).
 *
 * `onLimit: 'skip'` is for a step whose visitor must see the same answer either
 * way (a signup thanks a bot and a person alike): past the limit the step, and
 * every step after it in the segment, is skipped and the route answers as it
 * would for a request that changed nothing. A step marked `continueOnError`
 * is optional: past its limit only that step is skipped, and what follows it
 * (a booking's checkout after its newsletter tick) still runs. The skip is logged server-side
 * (the scope only — never the visitor's address or input), so an owner can
 * tell lost signups from no signups: at most one line per scope per minute
 * and per instance, the line saying how many more were skipped since the
 * last one — a bot past its limit does not flood the log.
 *
 * A declaration that cannot be read limits at the defaults (10 per hour): a
 * step that asked for a limit never runs without one.
 */

export const VISITOR_LIMIT_CONFIG_KEY = 'visitorLimit'

const DEFAULT_LIMIT = 10
const DEFAULT_WINDOW_SECONDS = 3600
const MAX_LIMIT = 10000
const MAX_WINDOW_SECONDS = 7 * 86400

export interface VisitorStepLimit {
  nodeId: string
  /** The shared budget the step names, if any. */
  scope?: string
  limit: number
  windowSeconds: number
  onLimit: 'refuse' | 'skip'
  /** What a refused visitor is told (the 429's public `error`), when the step names one. */
  message?: string
  /** The step and every step after it in the same segment (only the step when it is `continueOnError`). */
  skipIds: string[]
}

const SCOPE_RE = /^[A-Za-z0-9_-]{1,60}$/
const MAX_MESSAGE_LENGTH = 200

const wholeInRange = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max ? value : null

/** The limit a step's config declares, or null when it declares none. */
export const readVisitorStepLimit = (
  config: Record<string, unknown> | undefined
): Omit<VisitorStepLimit, 'nodeId' | 'skipIds'> | null => {
  const declared = config ? config[VISITOR_LIMIT_CONFIG_KEY] : undefined
  if (declared === undefined || declared === null || declared === false) {
    return null
  }
  const spec = typeof declared === 'object' ? (declared as Record<string, unknown>) : {}
  return {
    limit: wholeInRange(spec.limit, MAX_LIMIT) ?? DEFAULT_LIMIT,
    windowSeconds: wholeInRange(spec.windowSeconds, MAX_WINDOW_SECONDS) ?? DEFAULT_WINDOW_SECONDS,
    onLimit: spec.onLimit === 'skip' ? 'skip' : 'refuse',
    ...(typeof spec.scope === 'string' && SCOPE_RE.test(spec.scope) ? { scope: spec.scope } : {}),
    ...(typeof spec.message === 'string' && spec.message.trim()
      ? { message: spec.message.trim().slice(0, MAX_MESSAGE_LENGTH) }
      : {}),
  }
}

const downstreamInSegment = (segment: WorkflowSegment, startId: string): string[] => {
  const inSegment = new Set(segment.nodes.map((n) => n.id))
  const seen = new Set<string>()
  const queue = [startId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (seen.has(current) || !inSegment.has(current)) {
      continue
    }
    seen.add(current)
    for (const edge of segment.edges || []) {
      if (edge.source === current) {
        queue.push(edge.target)
      }
    }
  }
  return Array.from(seen)
}

/**
 * The limit a step of these types has when its config declares none: the
 * newsletter sign-up mails through the site's provider for every address a
 * visitor types, so a step from the add-node menu, the AI or an import is
 * held to the public sign-up route's own budget.
 */
const DEFAULT_VISITOR_STEP_LIMITS: Record<string, Omit<VisitorStepLimit, 'nodeId' | 'skipIds'>> = {
  'newsletter-subscribe': {
    limit: NEWSLETTER_VISITOR_LIMIT,
    windowSeconds: 3600,
    onLimit: 'skip',
    scope: NEWSLETTER_VISITOR_SCOPE,
  },
}

/** Every declared limit of a segment's steps (or its type's default), in step order. */
export const collectVisitorStepLimits = (segment: WorkflowSegment): VisitorStepLimit[] =>
  segment.nodes
    .slice()
    .sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    .reduce<VisitorStepLimit[]>((limits, node) => {
      const declared =
        readVisitorStepLimit(node.config as Record<string, unknown> | undefined) ||
        DEFAULT_VISITOR_STEP_LIMITS[node.type] ||
        null
      if (declared) {
        // An optional step (continueOnError) past its limit never stops what
        // follows it: only the step itself is skipped.
        const optional =
          (node.config as { continueOnError?: unknown } | undefined)?.continueOnError === true
        limits.push({
          nodeId: node.id,
          ...declared,
          skipIds:
            declared.onLimit !== 'skip'
              ? []
              : optional
              ? [node.id]
              : downstreamInSegment(segment, node.id),
        })
      }
      return limits
    }, [])

const SKIP_LOG_INTERVAL_MS = 60000

/** One log line per scope per minute (per instance); the rest are counted into the next line. */
const SKIP_LOG_CODE = `
      const __logStepLimitSkip = function (scope) {
        var log = globalThis.__tqStepLimitSkipLog || (globalThis.__tqStepLimitSkipLog = {});
        var now = Date.now();
        var entry = log[scope];
        if (entry && now - entry.since < ${SKIP_LOG_INTERVAL_MS}) {
          entry.skipped += 1;
          return;
        }
        var more = entry && entry.skipped > 0 ? ' (and ' + entry.skipped + ' more since the last line)' : '';
        console.warn('[workflow-step-limit] skipped past its visitor limit: ' + scope + more);
        log[scope] = { since: now, skipped: 0 };
      };`

/**
 * The route code that counts a segment's declared limits: '' for a segment
 * without one, so every other route is byte-identical. Placed after the
 * request context is claimed and the auth guard has run, before any step.
 * `relativePrefix` leads from the route's folder to the project root.
 */
export const buildVisitorStepLimitGuard = (
  segment: WorkflowSegment,
  relativePrefix = '../../..'
): string => {
  const limits = collectVisitorStepLimits(segment)
  if (limits.length === 0) {
    return ''
  }
  const checks = limits.map((step) => {
    const scope = step.scope ? `visitor-limit:${step.scope}` : `workflow-step:${step.nodeId}`
    const options = JSON.stringify({
      scope,
      limit: step.limit,
      windowSeconds: step.windowSeconds,
    })
    if (step.onLimit === 'skip') {
      // No response object: past the limit the runtime answers nothing itself.
      return `
      if (!(await __stepLimiter.rateLimitRequest(req, null, ${options}))) {
        __logStepLimitSkip(${JSON.stringify(scope)});
        if (!context.__skippedNodes || typeof context.__skippedNodes !== 'object') context.__skippedNodes = {};
        ${JSON.stringify(
          step.skipIds
        )}.forEach(function (id) { context.__skippedNodes[id] = true; });
      }`
    }
    if (step.message) {
      // Counted like any refused step; the 429 carries the step's own words.
      return `
      if (!(await __stepLimiter.rateLimitRequest(req, null, ${options}))) {
        var __stepRetry = typeof __stepLimiter.peekRateLimitRequest === 'function' ? await __stepLimiter.peekRateLimitRequest(req, ${options}) : null;
        if (__stepRetry && __stepRetry.retryAfter) res.setHeader('Retry-After', String(__stepRetry.retryAfter));
        return res.status(429).json({ error: ${JSON.stringify(step.message)} });
      }`
    }
    return `
      if (!(await __stepLimiter.rateLimitRequest(req, res, ${options}))) {
        return;
      }`
  })
  return `
    // Steps that declare how often one visitor may run them (a guest booking,
    // a newsletter signup — see visitor-step-limits.ts): counted per visitor in
    // the app's database for every request this route answers, before any step
    // runs. This deployment's own server code is not counted.
    if (!require('${relativePrefix}/utils/workflows/server-runtime').isInternalCall(req)) {
      const __stepLimiter = require('${securityRuntimeSpecifier(relativePrefix)}');${
    limits.some((step) => step.onLimit === 'skip') ? SKIP_LOG_CODE : ''
  }${checks.join('')}
    }`
}
