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

  // `source` came from `handlerToString(fn)` on a real, possibly-minified
  // function — its ENTIRE text is that one function's declaration, so
  // whatever name follows the leading `function`/`async function` keyword is
  // the name it was actually assigned at runtime.
  const leadingDeclaration = source.match(/^(?:async\s+)?function\s*([A-Za-z0-9_$]+)\s*\(/)
  if (leadingDeclaration) {
    return leadingDeclaration[1]
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
