import { evaluateEmittedModule } from './load-invoice-route'
import { generatePaymentCoreCode } from '../../src/payments/payment-core-code'
import { generatePaymentRegistryCode } from '../../src/payments/payment-registry-code'
import { PAYMENT_DRIVER_CODE } from '../../src/payments/payment-driver-code-map'
import { PAYMENT_DRIVER_IDS, PaymentDriverId } from '../../src/payments/payment-drivers-scope'

export interface PaymentDriverRegistry {
  ids: string[]
  core: any
  get(providerId: string): any
}

export interface LoadPaymentDriversOptions {
  /** The providers the store carries; every driver by default. */
  ids?: PaymentDriverId[]
  /**
   * What the Stripe driver's `require('stripe')` returns — a fake SDK
   * constructor. Absent, a fake a test put on
   * `globalThis.__non_webpack_require__` answers (resolved at call time, so a
   * test can install it after loading), else the require throws exactly as it
   * would in a store whose `stripe` package is missing.
   */
  stripe?: unknown
}

/**
 * The store's `utils/payments` registry, evaluated from the EMITTED module
 * sources exactly as a generated route requires it.
 */
export const loadPaymentDrivers = (
  options: LoadPaymentDriversOptions = {}
): PaymentDriverRegistry => {
  const ids = options.ids || [...PAYMENT_DRIVER_IDS]
  const driverRequire = ((id: string) => {
    if (id === 'stripe') {
      if (options.stripe) {
        return options.stripe
      }
      const injected = (globalThis as { __non_webpack_require__?: (name: string) => unknown })
        .__non_webpack_require__
      if (typeof injected === 'function') {
        return injected('stripe')
      }
      throw new Error("Cannot find module 'stripe'")
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as unknown as NodeRequire
  const core = evaluateEmittedModule(generatePaymentCoreCode(), driverRequire)
  const drivers: Record<string, unknown> = {}
  for (const id of ids) {
    drivers[id] = evaluateEmittedModule(PAYMENT_DRIVER_CODE[id](), driverRequire)
  }
  const registryRequire = ((id: string) => {
    if (id === './core') {
      return core
    }
    const driver = /^\.\/drivers\/([a-z]+)$/.exec(id)
    if (driver) {
      return drivers[driver[1]]
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id)
  }) as unknown as NodeRequire
  return evaluateEmittedModule<PaymentDriverRegistry>(
    generatePaymentRegistryCode(ids),
    registryRequire
  )
}
