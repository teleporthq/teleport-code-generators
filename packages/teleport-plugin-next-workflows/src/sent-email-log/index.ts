import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { resolveInvoiceDataSource } from '../invoice/resolve-data-source'
import { generateSentEmailLogCode } from './sent-email-log-code'
import {
  SENT_EMAIL_LOG_FILE_KEY,
  SENT_EMAIL_LOG_FILE_NAME,
  SENT_EMAIL_LOG_PATH,
} from './sent-email-log-scope'

export {
  EMAIL_CAPABLE_INTEGRATION_NODE_TYPES,
  hasEmailSendingNodeType,
  isEmailSendingNodeType,
} from './sent-email-log-scope'
export { generateSentEmailLogCode } from './sent-email-log-code'

/**
 * Writes `utils/email/sent-email-log.js` into the project, once. Every
 * emitter of a send path calls this right where it emits the code that
 * `require`s the module (workflow routes, the invoice sender, the account
 * routes, the e-commerce notification sender), so the file exists exactly
 * when something needs it, whichever plugin ran first.
 *
 * The ledger is Postgres-only: on another data source the module is a no-op
 * with the same exports. The `pg` dependency is added only when the project's
 * database is Postgres, through the same driver map auth and invoices use.
 */
export const ensureSentEmailLogModule = (structure: ProjectPluginStructure): void => {
  const { files, dependencies } = structure
  if (files.has(SENT_EMAIL_LOG_FILE_KEY)) {
    return
  }

  const { dataSourceType } = resolveInvoiceDataSource(structure)
  const driverDeps = getDatabaseDriverDependencies(dataSourceType)
  const pgSupported = 'pg' in driverDeps

  files.set(SENT_EMAIL_LOG_FILE_KEY, {
    path: SENT_EMAIL_LOG_PATH,
    files: [
      {
        name: SENT_EMAIL_LOG_FILE_NAME,
        fileType: FileType.JS,
        content: generateSentEmailLogCode({ pgSupported }),
      },
    ],
  })

  if (pgSupported) {
    for (const [pkg, version] of Object.entries(driverDeps)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }
  }
}

/**
 * In a project with automations, files a send made by an automation handler
 * under the automation and the event's order (see the `attribution` option of
 * `generateSentEmailLogCode`). Rewrites the module when something already
 * required it; a project whose automations send no mail has none to rewrite.
 */
export const enableSentEmailAttribution = (structure: ProjectPluginStructure): void => {
  const entry = structure.files.get(SENT_EMAIL_LOG_FILE_KEY)
  if (!entry || !entry.files[0]) {
    return
  }
  const { dataSourceType } = resolveInvoiceDataSource(structure)
  const pgSupported = 'pg' in getDatabaseDriverDependencies(dataSourceType)
  entry.files[0].content = generateSentEmailLogCode({ pgSupported, attribution: true })
}
