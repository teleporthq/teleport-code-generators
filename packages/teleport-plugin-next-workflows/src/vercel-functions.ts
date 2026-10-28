/**
 * `@vercel/functions` in a generated project: `waitUntil`, which keeps a
 * Vercel function running after its reply, and `attachDatabasePool`, which
 * closes a pool's idle connections before the function is suspended.
 *
 * The generated code loads it inside a try, so a project that does not have
 * it installed (or a bundler that cannot find it) keeps working without
 * either. A project whose emitted files require it declares it (see
 * `declareVercelFunctionsWhereRequired`).
 */
export const VERCEL_FUNCTIONS_PACKAGE = '@vercel/functions'

// The 2.x line still supports Node 18, which the Next project template allows;
// 3.x requires Node 20. attachDatabasePool is stable from 2.2.8.
export const VERCEL_FUNCTIONS_VERSION = '^2.2.13'

const VERCEL_FUNCTIONS_REQUIRE = `require('${VERCEL_FUNCTIONS_PACKAGE}')`

/**
 * `__vercelFunctions()` (the module, or null) and `__vercelWaitUntil()` (the
 * module's waitUntil while this code runs inside a Vercel request, else null).
 *
 * waitUntil does nothing outside a Vercel request (a local `next dev`, another
 * host): it reads the request context Vercel installs under
 * `Symbol.for('@vercel/request-context')` and silently drops the promise when
 * there is none. The same check here lets a caller await the work instead.
 */
export const generateVercelFunctionsLoaderCode = (): string => `var __vercelFunctionsModule;
function __vercelFunctions() {
  if (__vercelFunctionsModule === undefined) {
    try { __vercelFunctionsModule = ${VERCEL_FUNCTIONS_REQUIRE}; } catch (_e) { __vercelFunctionsModule = null; }
  }
  return __vercelFunctionsModule;
}

function __vercelWaitUntil() {
  var store = globalThis[Symbol.for('@vercel/request-context')];
  var requestContext = store && typeof store.get === 'function' ? store.get() : null;
  if (!requestContext || typeof requestContext.waitUntil !== 'function') return null;
  var vercel = __vercelFunctions();
  return vercel && typeof vercel.waitUntil === 'function' ? vercel.waitUntil : null;
}`

interface GeneratedFileRecord {
  files?: Array<{ content?: unknown }>
}

/**
 * Declares `@vercel/functions` in the project's dependencies when any emitted
 * file requires it, keeping a version the project already declares.
 */
export const declareVercelFunctionsWhereRequired = (
  files: Map<string, GeneratedFileRecord>,
  dependencies: Record<string, string>
): void => {
  if (dependencies[VERCEL_FUNCTIONS_PACKAGE]) {
    return
  }
  for (const record of files.values()) {
    for (const file of record.files || []) {
      if (typeof file.content === 'string' && file.content.includes(VERCEL_FUNCTIONS_REQUIRE)) {
        dependencies[VERCEL_FUNCTIONS_PACKAGE] = VERCEL_FUNCTIONS_VERSION
        return
      }
    }
  }
}
