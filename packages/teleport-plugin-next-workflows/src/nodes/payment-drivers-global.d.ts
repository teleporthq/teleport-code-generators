// The store's payment drivers (`utils/payments/index.js`), which every route
// that runs a payment node binds before its handlers (see
// `generatePaymentDriversPreamble`). Absent in a runtime that did not bind it,
// so a handler always reads it through `typeof`. Declared here so the handler
// sources type-check against it.
declare const __paymentDrivers:
  | {
      /** The shared helpers the drivers are built on (`utils/payments/core.js`). */
      core?: any
      get(providerId: string): any
    }
  | null
  | undefined
