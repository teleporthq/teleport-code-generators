import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { resolveInvoiceDataSource } from '../invoice/resolve-data-source'
import {
  generateSecurityRuntimeCode,
  SECURITY_RUNTIME_FILE_KEY,
  SECURITY_RUNTIME_FILE_NAME,
  SECURITY_RUNTIME_PATH,
} from './security-runtime-code'

export {
  generateSecurityRuntimeCode,
  RATE_LIMITS_TABLE,
  SECURITY_RUNTIME_FILE_KEY,
  SECURITY_RUNTIME_FILE_NAME,
  SECURITY_RUNTIME_PATH,
  securityRuntimeSpecifier,
  TOO_MANY_REQUESTS_MESSAGE,
} from './security-runtime-code'

/**
 * Writes `utils/security-runtime.js` into the project, once. The workflow
 * project plugin calls it for every app with server routes; an emitter whose
 * route can exist in an app without them calls it where it emits the route
 * that `require`s the module.
 *
 * The module is the same for every app (it finds the database at run time);
 * the `pg` driver is added only when the project's database is Postgres,
 * through the same driver map auth and invoices use.
 */
export const ensureSecurityRuntimeModule = (structure: ProjectPluginStructure): void => {
  const { files, dependencies } = structure
  if (files.has(SECURITY_RUNTIME_FILE_KEY)) {
    return
  }

  files.set(SECURITY_RUNTIME_FILE_KEY, {
    path: SECURITY_RUNTIME_PATH,
    files: [
      {
        name: SECURITY_RUNTIME_FILE_NAME,
        fileType: FileType.JS,
        content: generateSecurityRuntimeCode(),
      },
    ],
  })

  const { dataSourceType } = resolveInvoiceDataSource(structure)
  const driverDeps = getDatabaseDriverDependencies(dataSourceType)
  if ('pg' in driverDeps && !dependencies.pg) {
    dependencies.pg = driverDeps.pg
  }
}
