export type HandlerFn = (config: unknown, context: Record<string, unknown>) => Promise<unknown>

export function handlerToString(fn: HandlerFn): string {
  return fn.toString()
}

// Resolves the name a handler's entry function is ACTUALLY declared with in
// `source`, rather than assuming it always equals the
// `nodeType.replace(/-/g, '_')` convention name.
//
// Handlers built from `handlerToString(fn)` on a real function embed
// `fn.toString()` — a snapshot of whatever `fn` was actually named at the
// moment it's read. When this package is bundled and minified by a consumer
// (e.g. teleport-gui's browser packer worker, built with Next.js/Terser), the
// minifier freely renames `fn`'s declaration: nothing in the bundle calls it
// by name, only this runtime `.toString()` read does, which is invisible to
// the minifier. Callers that then reference the embedded handler by the
// static convention name get a "Collecting page data"/prerender
// ReferenceError, since local dev never runs a minifier.
//
// Handlers composed from string-literal templates (not `fn.toString()`) are
// immune to that class of breakage — a minifier never rewrites the contents
// of a string literal — so the convention name is still correct for those;
// this only needs to look further when it's genuinely absent from `source`.
export function resolveHandlerEntryName(source: string, nodeType: string): string {
  const conventionName = nodeType.replace(/-/g, '_')
  const conventionNameUsed = new RegExp(`(?:^|[^\\w$])${conventionName}\\s*\\(`).test(source)
  if (conventionNameUsed) {
    return conventionName
  }

  // `source` came from `handlerToString(fn)`/`fn.toString()` on a real,
  // possibly-minified function, and may be concatenated with OTHER
  // `.toString()`'d functions:
  //   - payment-charge-user.ts puts the entry FIRST, its own helpers after
  //     (`handlerToString(payment_charge_user) + '\n' + chargeWithStripe.toString() + ...`).
  //   - ai-custom-prompt.ts puts shared AI-provider utils BEFORE the entry
  //     (`generateAIProviderUtils() + '\n\n' + ai_custom_prompt.toString()`),
  //     where each util is `wrapWithGuard`-wrapped: `var X = typeof X !==
  //     'undefined' ? X : function Y() {...};` — a function EXPRESSION
  //     embedded in a ternary, not a statement-level declaration.
  // So the entry is not reliably first or last by position across handlers,
  // and helper functions can outnumber (or precede) the entry. What IS
  // reliable: every real entry point has exactly the HandlerFn signature —
  // 2 params (config, context) or 3 (config, context, streamCallback) — by
  // contract, while a handler's OWN internal helpers only coincidentally
  // share that arity (e.g. general-rate-limiter's __checkRateLimit takes 3
  // params too). So: collect every statement-level function declaration
  // (skipping ternary-embedded expressions like wrapWithGuard's), and prefer
  // an exactly-2-param candidate, then an exactly-3-param one, falling back
  // to positional order only if nothing matches the entry-point arity.
  const declPattern = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/g
  const candidates: string[] = []
  let twoParamCandidate: string | undefined
  let threeParamCandidate: string | undefined
  let declMatch: RegExpExecArray | null = declPattern.exec(source)
  while (declMatch !== null) {
    const precedingNonSpace = source.slice(0, declMatch.index).trimEnd().slice(-1)
    if (precedingNonSpace === ':' || precedingNonSpace === '?') {
      declMatch = declPattern.exec(source)
      continue // function EXPRESSION embedded in a ternary (e.g. wrapWithGuard's re-declaration guard)
    }
    const name = declMatch[1]
    candidates.push(name)
    const params = declMatch[2].trim()
    const paramCount = params === '' ? 0 : params.split(',').length
    if (paramCount === 2 && twoParamCandidate === undefined) {
      twoParamCandidate = name
    } else if (paramCount === 3 && threeParamCandidate === undefined) {
      threeParamCandidate = name
    }
    declMatch = declPattern.exec(source)
  }
  if (twoParamCandidate !== undefined) {
    return twoParamCandidate
  }
  if (threeParamCandidate !== undefined) {
    return threeParamCandidate
  }
  if (candidates.length > 0) {
    return candidates[0]
  }

  throw new Error(
    `Could not resolve the entry function for workflow node type "${nodeType}" — ` +
      `expected a "${conventionName}" declaration or a single toString()'d function, found neither.`
  )
}

export interface NodeHandlerGenerator {
  nodeType: string
  executionEnv: 'client' | 'server' | 'universal'
  isTerminal?: boolean
  dependencies?: Record<string, string>
  generateHandler(): string
  generateServerHandler?(): string
}

export interface IntegrationHandlerGenerator extends NodeHandlerGenerator {
  secretFields: string[]
}
