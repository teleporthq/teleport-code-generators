import {
  FileType,
  ProjectPluginStructure,
  ProjectUIDL,
  UIDLWorkflows,
} from '@teleporthq/teleport-types'
import { generatePaymentCoreCode } from './payment-core-code'
import { generatePaymentRegistryCode } from './payment-registry-code'
import { PAYMENT_DRIVER_CODE } from './payment-driver-code-map'
import {
  DEFAULT_PAYMENT_DRIVER_IDS,
  DeclaredPaymentCredentials,
  PAYMENT_DRIVERS_DIRECTORY,
  PAYMENT_DRIVERS_FILE_KEY,
  PAYMENT_DRIVERS_PATH,
  PAYMENT_DRIVER_IDS,
  PAYMENT_DRIVER_SIGNATURE_ALGORITHM,
  PaymentDriverId,
  isPaymentDriverId,
  usesPaymentDriverNode,
} from './payment-drivers-scope'

/** The Stripe SDK the Stripe driver requires; every other driver talks over fetch. */
const STRIPE_SDK_VERSION = '^14.0.0'

/**
 * The provider a payment webhook verifies through: the one its trigger names
 * with the `payment-driver` scheme, or — for a webhook stored before that
 * scheme existed, possibly with verification off, or a `payment-driver`
 * trigger that names none — the provider its `webhooks/<id>-payment` path
 * belongs to. Either way a payment webhook is ALWAYS verified: an unverified
 * one would mark orders paid on any request.
 *
 * Null on the `payment-driver` scheme means no driver can verify the
 * webhook (a provider without one, or none named on another path): its
 * route must refuse every delivery.
 */
export const readWebhookPaymentProvider = (webhookConfig: unknown): PaymentDriverId | null => {
  const config = (webhookConfig || {}) as {
    signatureAlgorithm?: unknown
    paymentProvider?: unknown
    urlPath?: unknown
  }
  const named =
    config.signatureAlgorithm === PAYMENT_DRIVER_SIGNATURE_ALGORITHM
      ? String(config.paymentProvider || '').trim()
      : ''
  const provider = (
    named ||
    (/(?:^|\/)webhooks\/([a-z]+)-payment\/?$/.exec(String(config.urlPath || '')) || [])[1] ||
    ''
  ).toLowerCase()
  return isPaymentDriverId(provider) ? provider : null
}

/**
 * Whether a webhook takes payment events: a provider's own route, or any
 * route on the `payment-driver` scheme. Such a route is always verified, and
 * runs one delivery of a body at a time (`webhook-delivery-lease`).
 */
export const isPaymentWebhookConfig = (webhookConfig: unknown): boolean =>
  readWebhookPaymentProvider(webhookConfig) !== null ||
  ((webhookConfig || {}) as { signatureAlgorithm?: unknown }).signatureAlgorithm ===
    PAYMENT_DRIVER_SIGNATURE_ALGORITHM

/**
 * The providers this store needs a driver for: every provider its checkout
 * offers, every provider a payment webhook verifies through, and Stripe +
 * PayPal whenever a payment node runs at all (a workflow that names no
 * provider has always meant Stripe). Empty when the store takes no online
 * payment, in which case no driver module is written.
 */
export const resolveStorePaymentDriverIds = (
  uidl: Pick<ProjectUIDL, 'ecommerceSettings'> & { workflows?: UIDLWorkflows },
  usedNodeTypes: Iterable<string>
): PaymentDriverId[] => {
  const wanted = new Set<PaymentDriverId>()
  for (const provider of uidl.ecommerceSettings?.paymentProviders || []) {
    const id = String(provider?.type || '').toLowerCase()
    if (isPaymentDriverId(id)) {
      wanted.add(id)
    }
  }
  for (const workflow of Object.values(uidl.workflows?.workflows || {})) {
    const id = readWebhookPaymentProvider((workflow as { webhookConfig?: unknown }).webhookConfig)
    if (id) {
      wanted.add(id)
    }
  }
  if (wanted.size > 0 || usesPaymentDriverNode(usedNodeTypes)) {
    DEFAULT_PAYMENT_DRIVER_IDS.forEach((id) => wanted.add(id))
  }
  return PAYMENT_DRIVER_IDS.filter((id) => wanted.has(id))
}

/** An environment variable name, the only shape a declared secret may take. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The secret the merchant saved each live provider credential under, as the
 * editor exported it (`ecommerceSettings.paymentProviders[].credentials`).
 */
export const readDeclaredPaymentCredentials = (
  uidl: Pick<ProjectUIDL, 'ecommerceSettings'> | undefined
): DeclaredPaymentCredentials => {
  const declared: DeclaredPaymentCredentials = {}
  for (const provider of uidl?.ecommerceSettings?.paymentProviders || []) {
    const id = String(provider?.type || '').toLowerCase()
    if (!isPaymentDriverId(id)) {
      continue
    }
    const fields: Record<string, string> = {}
    for (const [field, secretName] of Object.entries(provider.credentials || {})) {
      if (typeof secretName === 'string' && ENV_NAME_PATTERN.test(secretName)) {
        fields[field] = secretName
      }
    }
    if (Object.keys(fields).length > 0) {
      declared[id] = fields
    }
  }
  return declared
}

/**
 * Writes `utils/payments/` — core, registry and one driver per provider —
 * once, whichever emitter asks first. Every emitter of code that reaches
 * `__paymentDrivers` calls this with the store's providers.
 */
export const ensurePaymentDriversModule = (
  structure: ProjectPluginStructure,
  driverIds: readonly PaymentDriverId[]
): void => {
  const { files, dependencies } = structure
  if (driverIds.length === 0 || files.has(PAYMENT_DRIVERS_FILE_KEY)) {
    return
  }
  const declared = readDeclaredPaymentCredentials(structure.uidl)
  files.set(PAYMENT_DRIVERS_FILE_KEY, {
    path: PAYMENT_DRIVERS_PATH,
    files: [
      { name: 'index', fileType: FileType.JS, content: generatePaymentRegistryCode(driverIds) },
      { name: 'core', fileType: FileType.JS, content: generatePaymentCoreCode(declared) },
    ],
  })
  files.set(`${PAYMENT_DRIVERS_FILE_KEY}-drivers`, {
    path: PAYMENT_DRIVERS_DIRECTORY,
    files: driverIds.map((id) => ({
      name: id,
      fileType: FileType.JS,
      content: PAYMENT_DRIVER_CODE[id](),
    })),
  })
  if (driverIds.includes('stripe') && !dependencies.stripe) {
    dependencies.stripe = STRIPE_SDK_VERSION
  }
}

/**
 * The environment variable a provider credential is deployed under — the
 * editor's field key in upper snake case after the provider id
 * (`stripe` + `secretKey` → `STRIPE_SECRET_KEY`), which is the first name
 * each driver reads (`core.credential`).
 */
export const paymentCredentialEnvName = (providerId: string, field: string): string =>
  `${providerId.toUpperCase()}_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`

/**
 * Declares every credential the merchant saved for a store provider in the
 * project's `.env`, as a placeholder the deploy resolves to that exact stored
 * secret (`MOLLIE_API_KEY=teleporthq.secrets.<stored name>`) — never by a
 * guess at which secret looks like it. A line something else already filled
 * is left alone.
 */
export const declarePaymentCredentialEnv = (uidl: ProjectUIDL): void => {
  const declared = readDeclaredPaymentCredentials(uidl)
  for (const [id, fields] of Object.entries(declared)) {
    for (const [field, secretName] of Object.entries(fields || {})) {
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      const envName = paymentCredentialEnvName(id, field)
      if (!uidl.globals.env[envName]) {
        uidl.globals.env[envName] = `teleporthq.secrets.${secretName}`
      }
    }
  }
}

/**
 * The binding a route needs when it runs a payment node or verifies a
 * payment webhook: a guarded require, so a route evaluated where the module
 * is absent (a test harness, a stub `require`) still loads and every payment
 * call answers "not supported" instead of crashing the route. Empty for every
 * other route, which keeps those byte-identical.
 */
export const generatePaymentDriversPreamble = (needed: boolean, relativePrefix: string): string => {
  if (!needed) {
    return ''
  }
  return `var __paymentDrivers = null;
try { __paymentDrivers = require('${relativePrefix}/utils/payments'); } catch (_e) { __paymentDrivers = null; }
`
}
