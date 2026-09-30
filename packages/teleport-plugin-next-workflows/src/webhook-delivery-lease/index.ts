import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { resolveInvoiceDataSource } from '../invoice/resolve-data-source'
import { generateWebhookDeliveryLeaseCode } from './webhook-delivery-lease-code'
import {
  WEBHOOK_DELIVERY_LEASE_FILE_KEY,
  WEBHOOK_DELIVERY_LEASE_FILE_NAME,
  WEBHOOK_DELIVERY_LEASE_PATH,
} from './webhook-delivery-lease-scope'

/**
 * Writes `utils/workflows/webhook-delivery-lease.js` into the project, once —
 * called for every payment webhook route, which requires it. Postgres only:
 * on another data source the module claims nothing, with the same export.
 */
export const ensureWebhookDeliveryLeaseModule = (structure: ProjectPluginStructure): void => {
  const { files, dependencies } = structure
  if (files.has(WEBHOOK_DELIVERY_LEASE_FILE_KEY)) {
    return
  }

  const { dataSourceType } = resolveInvoiceDataSource(structure)
  const driverDeps = getDatabaseDriverDependencies(dataSourceType)
  const pgSupported = 'pg' in driverDeps

  files.set(WEBHOOK_DELIVERY_LEASE_FILE_KEY, {
    path: WEBHOOK_DELIVERY_LEASE_PATH,
    files: [
      {
        name: WEBHOOK_DELIVERY_LEASE_FILE_NAME,
        fileType: FileType.JS,
        content: generateWebhookDeliveryLeaseCode({ pgSupported }),
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
