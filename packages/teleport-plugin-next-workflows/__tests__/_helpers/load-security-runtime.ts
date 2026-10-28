import * as nodeCrypto from 'crypto'
import * as net from 'net'
import { generateSecurityRuntimeCode } from '../../src/security-runtime/security-runtime-code'

/**
 * A generated file's `require` of the shared security runtime
 * (`utils/security-runtime.js`), from whatever folder it sits in.
 */
export const isSecurityRuntimeSpecifier = (name: string): boolean =>
  /(^|\/)utils\/security-runtime$/.test(name)

/**
 * One app instance's `utils/security-runtime.js` with no database: it counts
 * rate limits in memory and logs nothing. What a spec's `require` shim answers
 * for `isSecurityRuntimeSpecifier` (the data routes compare the app secret
 * with its `safeEqual`).
 */
export const loadSecurityRuntime = (): any => {
  const module = { exports: {} as any }
  const quiet = {
    warn: (): void => undefined,
    error: (): void => undefined,
    log: (): void => undefined,
  }
  const requireShim = (id: string): unknown => {
    if (id === 'crypto') {
      return nodeCrypto
    }
    if (id === 'net') {
      return net
    }
    throw new Error("Cannot find module '" + id + "'")
  }
  // eslint-disable-next-line no-new-func
  new Function(
    'module',
    'exports',
    'require',
    'process',
    'console',
    'Buffer',
    generateSecurityRuntimeCode()
  )(module, module.exports, requireShim, { env: {} }, quiet, Buffer)
  return module.exports
}
