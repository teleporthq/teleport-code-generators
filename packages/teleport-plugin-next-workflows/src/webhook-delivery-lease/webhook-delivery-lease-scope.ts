/**
 * Where the payment webhook delivery lease lives in the generated project
 * (`utils/workflows/webhook-delivery-lease.js`), and the table it keeps.
 */

export const WEBHOOK_DELIVERY_LEASE_FILE_KEY = 'webhook-delivery-lease'
export const WEBHOOK_DELIVERY_LEASE_PATH = ['utils', 'workflows']
export const WEBHOOK_DELIVERY_LEASE_FILE_NAME = 'webhook-delivery-lease'
export const WEBHOOK_DELIVERY_LEASE_TABLE = 'teleport_webhook_deliveries'

/**
 * How long a claim holds before another delivery may take it over: longer
 * than any route may run, so a claim is only ever taken from a run that died.
 */
export const WEBHOOK_DELIVERY_LEASE_SECONDS = 300

/** What a delivery that finds its twin still running is told to wait, in seconds. */
export const WEBHOOK_DELIVERY_RETRY_AFTER_SECONDS = 60
