import * as crypto from 'crypto'
import { generateSharedRuntimeUtilsCode } from '../../src/executor-generator'
import { generateServerRuntimeCode } from '../../src/server-runtime-code'

export interface ServerRuntimeOptions {
  /**
   * next-auth's `getToken`, for a runtime that decodes the visitor's session
   * cookie. Without it `next-auth/jwt` is absent and every visitor is a guest.
   */
  getToken?: (params: { req: unknown }) => unknown
  /**
   * Packages a project may have installed (`@vercel/functions`). Any other
   * require is missing. A plain module map (no `getToken`) is accepted as this.
   */
  modules?: Record<string, unknown>
}

/**
 * The generated `utils/workflows/server-runtime.js` exactly as a route loads
 * it: the shared runtime utilities plus the server-only signed hand-off,
 * session identity, internal-call token and trusted base URL.
 */
export function loadServerRuntime(
  options: ServerRuntimeOptions | Record<string, unknown> = {}
): Record<string, any> {
  const asOptions = options as ServerRuntimeOptions
  const named =
    typeof asOptions.getToken === 'function' ||
    (asOptions.modules != null && typeof asOptions.modules === 'object')
  const getToken = named ? asOptions.getToken : undefined
  const modules = named ? asOptions.modules || {} : (options as Record<string, unknown>)
  const shared: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', generateSharedRuntimeUtilsCode())(shared, shared.exports)
  const server: { exports: Record<string, any> } = { exports: {} }
  const requireFn = (id: string): unknown => {
    if (id === 'crypto') {
      return crypto
    }
    if (id === './runtime-utils') {
      return shared.exports
    }
    if (id === 'next-auth/jwt' && getToken) {
      return { getToken }
    }
    if (id in modules) {
      return modules[id]
    }
    throw new Error(`Unexpected require in server runtime: ${id}`)
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', 'process', 'Buffer', generateServerRuntimeCode())(
    server,
    server.exports,
    requireFn,
    process,
    Buffer
  )
  return server.exports
}
