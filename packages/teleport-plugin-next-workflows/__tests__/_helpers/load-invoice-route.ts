/* tslint:disable:function-constructor */
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generateInvoiceAssemblyCode } from '../../src/invoice/invoice-assembly-code'

/**
 * Evaluates EMITTED CommonJS source (a generated route or util) as a real
 * module, resolving its `require` calls through `requireFn`.
 */
export function evaluateEmittedModule<T>(code: string, requireFn: NodeRequire): T {
  const factory = new Function(
    'require',
    'module',
    'exports',
    `${code}; return module.exports;`
  ) as (req: NodeRequire, mod: { exports: unknown }, exp: unknown) => T
  const moduleObject = { exports: {} as unknown }
  return factory(requireFn, moduleObject, moduleObject.exports)
}

export interface InvoiceRouteStubs {
  /** Stands in for `utils/invoices/data-access.js`. */
  dataAccess: unknown
  /** Stands in for `utils/invoices/pdf-generator.js`. */
  pdfGenerator: unknown
  /** Any other module id the code under test requires, e.g. `next-auth/jwt`. */
  modules?: Record<string, unknown>
}

/**
 * The `require` an emitted invoice route sees: the two stubs, the REAL emitted
 * `utils/invoices/invoice-assembly.js` built from `settings` (wired to the same
 * stubs), a no-op `pg`, and Node's own resolution for everything else.
 */
export function createInvoiceRouteRequire(
  settings: UIDLInvoiceSettings,
  stubs: InvoiceRouteStubs
): NodeRequire {
  let assembly: unknown = null
  const requireFn = ((id: string) => {
    if (id.indexOf('data-access') !== -1) {
      return stubs.dataAccess
    }
    if (id.indexOf('pdf-generator') !== -1) {
      return stubs.pdfGenerator
    }
    if (id.indexOf('invoice-assembly') !== -1) {
      if (!assembly) {
        assembly = evaluateEmittedModule(generateInvoiceAssemblyCode(settings), requireFn)
      }
      return assembly
    }
    if (stubs.modules && id in stubs.modules) {
      return stubs.modules[id]
    }
    if (id === 'pg') {
      return { Client: class {} }
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as unknown as NodeRequire
  return requireFn
}

/**
 * The app secret the invoice routes' own server callers present (the invoice
 * node and the payment webhooks send it as `x-internal-data-secret`). Tests
 * that play such a caller set it as NEXTAUTH_SECRET and send it.
 */
export const INVOICE_TEST_APP_SECRET = 'invoice-test-app-secret'

/** Headers of a request from this deployment's own server code. */
export const serverCallHeaders = (): Record<string, string> => ({
  host: 'localhost:3000',
  'x-internal-data-secret': INVOICE_TEST_APP_SECRET,
})
