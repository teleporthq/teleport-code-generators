import { FileType } from '@teleporthq/teleport-types'
import {
  declarePaymentCredentialEnv,
  ensurePaymentDriversModule,
  generatePaymentDriversPreamble,
  paymentCredentialEnvName,
  readDeclaredPaymentCredentials,
  readWebhookPaymentProvider,
  resolveStorePaymentDriverIds,
} from '../src/payments'
import { generatePaymentCoreCode } from '../src/payments/payment-core-code'
import { PAYMENT_DRIVER_IDS } from '../src/payments/payment-drivers-scope'
import { loadPaymentDrivers } from './_helpers/load-payment-drivers'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'
import { withEnv } from './_helpers/fake-fetch'

/**
 * The store's `utils/payments/` module: which providers a store carries, how
 * it is written, how a route binds it, and the core every driver shares —
 * executed from the emitted source.
 */

const structure = () => ({
  files: new Map<
    string,
    { path: string[]; files: Array<{ name: string; fileType: string; content: string }> }
  >(),
  dependencies: {} as Record<string, string>,
  devDependencies: {},
  uidl: {} as any,
  template: {} as any,
  rootFolder: {} as any,
})

describe('which providers a store carries', () => {
  it('carries its checkout providers and its payment webhooks, plus Stripe and PayPal', () => {
    const ids = resolveStorePaymentDriverIds(
      {
        ecommerceSettings: {
          paymentProviders: [{ type: 'Mollie' }, { type: 'adyen' }, { type: 'coingate' }],
        } as any,
        workflows: {
          workflows: {
            a: { webhookConfig: { urlPath: 'webhooks/paddle-payment' } },
            b: {
              webhookConfig: {
                signatureAlgorithm: 'payment-driver',
                paymentProvider: 'square',
                urlPath: 'hooks/sq',
              },
            },
            c: { webhookConfig: { urlPath: 'hooks/orders' } },
          },
        } as any,
      },
      []
    )
    expect(ids).toEqual(['stripe', 'paypal', 'mollie', 'square', 'paddle', 'coingate'])
  })

  it('carries Stripe and PayPal when only a payment node needs them, and nothing otherwise', () => {
    expect(
      resolveStorePaymentDriverIds({ ecommerceSettings: undefined }, ['payment-refund'])
    ).toEqual(['stripe', 'paypal'])
    expect(resolveStorePaymentDriverIds({ ecommerceSettings: undefined }, ['data-select'])).toEqual(
      []
    )
  })

  it('reads a payment webhook by its scheme, or by the path an older trigger was stored on', () => {
    expect(
      readWebhookPaymentProvider({
        signatureAlgorithm: 'payment-driver',
        paymentProvider: ' Razorpay ',
      })
    ).toBe('razorpay')
    expect(
      readWebhookPaymentProvider({
        signatureAlgorithm: 'stripe-v1',
        urlPath: '/webhooks/stripe-payment/',
      })
    ).toBe('stripe')
    expect(readWebhookPaymentProvider({ urlPath: 'webhooks/adyen-payment' })).toBeNull()
    expect(readWebhookPaymentProvider({ urlPath: 'webhooks/stripe-payment-copy' })).toBeNull()
    expect(
      readWebhookPaymentProvider({
        signatureAlgorithm: 'payment-driver',
        paymentProvider: 'adyen',
        urlPath: 'webhooks/stripe-payment',
      })
    ).toBeNull()
    expect(readWebhookPaymentProvider(undefined)).toBeNull()
  })

  it('reads a payment-driver trigger that names no provider by its payment path', () => {
    expect(
      readWebhookPaymentProvider({
        signatureAlgorithm: 'payment-driver',
        paymentProvider: ' ',
        urlPath: 'webhooks/mollie-payment',
      })
    ).toBe('mollie')
    expect(
      readWebhookPaymentProvider({ signatureAlgorithm: 'payment-driver', urlPath: 'hooks/pay' })
    ).toBeNull()
  })
})

describe('writing the module', () => {
  it('writes the registry, the core and one driver per provider, once', () => {
    const target = structure()
    ensurePaymentDriversModule(target as any, ['paypal', 'mollie'])
    ensurePaymentDriversModule(target as any, ['stripe'])
    expect([...target.files.keys()]).toEqual(['payment-drivers', 'payment-drivers-drivers'])
    const root = target.files.get('payment-drivers')
    expect(root.path).toEqual(['utils', 'payments'])
    expect(root.files.map((file) => [file.name, file.fileType])).toEqual([
      ['index', FileType.JS],
      ['core', FileType.JS],
    ])
    expect(root.files[0].content).toContain(`"paypal": require('./drivers/paypal'),`)
    expect(root.files[0].content).not.toContain('stripe')
    const drivers = target.files.get('payment-drivers-drivers')
    expect(drivers.path).toEqual(['utils', 'payments', 'drivers'])
    expect(drivers.files.map((file) => file.name)).toEqual(['paypal', 'mollie'])
    // The first writer decided: the Stripe SDK arrives only with the Stripe driver.
    expect(target.dependencies.stripe).toBeUndefined()
  })

  it('adds the Stripe SDK with the Stripe driver, keeping a version already pinned', () => {
    const fresh = structure()
    ensurePaymentDriversModule(fresh as any, ['stripe'])
    expect(fresh.dependencies.stripe).toBe('^14.0.0')
    const pinned = structure()
    pinned.dependencies.stripe = '15.1.0'
    ensurePaymentDriversModule(pinned as any, ['stripe'])
    expect(pinned.dependencies.stripe).toBe('15.1.0')
  })

  it('bakes the secret names the editor saved into the core, and nothing that is not a name', () => {
    const uidl = {
      ecommerceSettings: {
        paymentProviders: [
          {
            type: 'razorpay',
            credentials: { keyId: 'CONFIGURATION_RAZORPAY_KEY_ID1', keySecret: '' },
          },
          { type: 'square', credentials: { accessToken: 'bad name; process.exit()' } },
          { type: 'adyen', credentials: { apiKey: 'CONFIGURATION_ADYEN_API_KEY' } },
          { type: 'mollie' },
        ],
      },
    } as any
    expect(readDeclaredPaymentCredentials(uidl)).toEqual({
      razorpay: { keyId: 'CONFIGURATION_RAZORPAY_KEY_ID1' },
    })
    expect(readDeclaredPaymentCredentials(undefined)).toEqual({})
    const target = { ...structure(), uidl }
    ensurePaymentDriversModule(target as any, ['razorpay'])
    const core = target.files.get('payment-drivers').files[1].content
    expect(core).toContain(
      'var DECLARED_CREDENTIALS = {"razorpay":{"keyId":"CONFIGURATION_RAZORPAY_KEY_ID1"}};'
    )
  })

  it('writes nothing for a store that takes no online payment', () => {
    const target = structure()
    ensurePaymentDriversModule(target as any, [])
    expect(target.files.size).toBe(0)
  })

  it('binds a route to the module with a require that cannot crash it', () => {
    expect(generatePaymentDriversPreamble(false, '../..')).toBe('')
    const preamble = generatePaymentDriversPreamble(true, '../../..')
    expect(preamble).toContain("require('../../../utils/payments')")
    // eslint-disable-next-line no-new-func
    const bound = new Function('require', `${preamble}; return __paymentDrivers;`)(() => {
      throw new Error('missing')
    })
    expect(bound).toBeNull()
  })

  it('answers a driver per carried provider, built once, and nothing for any other', () => {
    const registry = loadPaymentDrivers({ ids: ['mollie', 'coingate'] })
    expect(registry.ids).toEqual(['mollie', 'coingate'])
    expect(registry.get(' MOLLIE ')).toBe(registry.get('mollie'))
    expect(registry.get('mollie').id).toBe('mollie')
    expect(registry.get('stripe')).toBeNull()
    expect(registry.get('__proto__')).toBeNull()
    expect(registry.get(undefined)).toBeNull()
  })

  it('every driver answers the whole contract', () => {
    const registry = loadPaymentDrivers()
    for (const id of registry.ids) {
      const driver = registry.get(id)
      expect(driver.id).toBe(id)
      for (const method of [
        'createCheckout',
        'createSubscriptionCheckout',
        'ensurePlan',
        'refund',
        'manageSubscription',
        'billingPortal',
        'verifyWebhook',
      ]) {
        expect(typeof driver[method]).toBe('function')
      }
    }
  })

  it('every driver settles a payment from its provider, and names what settles a checkout', () => {
    const registry = loadPaymentDrivers()
    expect(registry.ids).toEqual([...PAYMENT_DRIVER_IDS])
    for (const id of registry.ids) {
      const driver = registry.get(id)
      expect(typeof driver.reconcile).toBe('function')
      expect(typeof driver.reconcileKinds).toBe('function')
      // Pure: nothing to settle for a reference that is no checkout at all.
      expect(driver.reconcileKinds('')).toEqual([])
      expect(driver.reconcileKinds('../../etc')).toEqual([])
    }
  })
})

describe('credentials in the environment', () => {
  it('names a credential the way the editor names its field', () => {
    expect(paymentCredentialEnvName('stripe', 'secretKey')).toBe('STRIPE_SECRET_KEY')
    expect(paymentCredentialEnvName('paypal', 'webhookId')).toBe('PAYPAL_WEBHOOK_ID')
    expect(paymentCredentialEnvName('coingate', 'apiToken')).toBe('COINGATE_API_TOKEN')
  })

  it('declares each saved credential as a placeholder for that exact stored secret', () => {
    const uidl: any = {
      globals: { env: { MOLLIE_API_KEY: 'already-set' } },
      ecommerceSettings: {
        paymentProviders: [
          {
            type: 'mollie',
            credentials: { apiKey: 'CONFIGURATION_MOLLIE_API_KEY2', profileId: '' },
          },
          {
            type: 'square',
            credentials: {
              accessToken: 'CONFIGURATION_SQUARE_ACCESS_TOKEN',
              webhookSignatureKey: 'CONFIGURATION_SQUARE_WEBHOOK_SIGNATURE_KEY',
            },
          },
          { type: 'adyen', credentials: { apiKey: 'CONFIGURATION_ADYEN_API_KEY' } },
        ],
      },
    }
    declarePaymentCredentialEnv(uidl)
    expect(uidl.globals.env).toEqual({
      MOLLIE_API_KEY: 'already-set',
      SQUARE_ACCESS_TOKEN: 'teleporthq.secrets.CONFIGURATION_SQUARE_ACCESS_TOKEN',
      SQUARE_WEBHOOK_SIGNATURE_KEY: 'teleporthq.secrets.CONFIGURATION_SQUARE_WEBHOOK_SIGNATURE_KEY',
    })
  })

  it('leaves the environment alone when no provider saved a credential', () => {
    const uidl: any = { globals: {}, ecommerceSettings: { paymentProviders: [{ type: 'stripe' }] } }
    declarePaymentCredentialEnv(uidl)
    expect(uidl.globals.env).toBeUndefined()
  })
})

describe('the shared payment core', () => {
  const core = loadPaymentDrivers({ ids: [] }).core

  it('reads the deployed name, then the stored one, then a numbered copy of it', async () => {
    const names: Record<string, string | undefined> = {
      MOLLIE_API_KEY: undefined,
      CONFIGURATION_MOLLIE_API_KEY: undefined,
      CONFIGURATION_MOLLIE_API_KEY2: undefined,
    }
    await withEnv({ ...names, CONFIGURATION_MOLLIE_API_KEY2: 'numbered' }, async () => {
      expect(core.credential('mollie', 'apiKey')).toBe('numbered')
    })
    await withEnv(
      {
        ...names,
        CONFIGURATION_MOLLIE_API_KEY: 'stored',
        CONFIGURATION_MOLLIE_API_KEY2: 'numbered',
      },
      async () => {
        expect(core.credential('mollie', 'apiKey')).toBe('stored')
      }
    )
    await withEnv(
      { ...names, MOLLIE_API_KEY: 'deployed', CONFIGURATION_MOLLIE_API_KEY: 'stored' },
      async () => {
        expect(core.credential('mollie', 'apiKey')).toBe('deployed')
      }
    )
    await withEnv(names, async () => {
      expect(core.credential('mollie', 'apiKey')).toBe('')
    })
  })

  it('reads the secret the editor declared, never the older unnumbered one it replaced', async () => {
    const declared = evaluateEmittedModule<any>(
      generatePaymentCoreCode({
        razorpay: {
          keyId: 'CONFIGURATION_RAZORPAY_KEY_ID1',
          keySecret: 'CONFIGURATION_RAZORPAY_KEY_SECRET1',
        },
      }),
      require
    )
    const env = {
      RAZORPAY_KEY_ID: undefined,
      CONFIGURATION_RAZORPAY_KEY_ID: 'rzp_test_old',
      CONFIGURATION_RAZORPAY_KEY_ID1: 'rzp_test_new',
      CONFIGURATION_RAZORPAY_KEY_SECRET: 'old-secret',
      CONFIGURATION_RAZORPAY_KEY_SECRET1: undefined,
    }
    await withEnv(env, async () => {
      expect(declared.credential('razorpay', 'keyId')).toBe('rzp_test_new')
      // A declared secret that is empty here is empty: no older one stands in.
      expect(declared.credential('razorpay', 'keySecret')).toBe('')
      // An undeclared field keeps the older store's lookup.
      expect(core.credential('razorpay', 'keyId')).toBe('rzp_test_old')
    })
    // What a deploy writes (the canonical name, resolved to the declared secret) wins.
    await withEnv({ ...env, RAZORPAY_KEY_ID: 'rzp_live_deployed' }, async () => {
      expect(declared.credential('razorpay', 'keyId')).toBe('rzp_live_deployed')
    })
  })

  it('never takes a placeholder the deploy did not resolve for a credential', async () => {
    const declared = evaluateEmittedModule<any>(
      generatePaymentCoreCode({ razorpay: { keyId: 'CONFIGURATION_RAZORPAY_KEY_ID1' } }),
      require
    )
    // A project run outside a deploy (a download, a local build) keeps the
    // `.env` line the deploy would have resolved.
    await withEnv(
      {
        RAZORPAY_KEY_ID: 'teleporthq.secrets.CONFIGURATION_RAZORPAY_KEY_ID1',
        CONFIGURATION_RAZORPAY_KEY_ID1: 'rzp_test_new',
        MOLLIE_API_KEY: 'teleporthq.secrets.CONFIGURATION_MOLLIE_API_KEY',
        CONFIGURATION_MOLLIE_API_KEY: 'teleporthq.secrets.X',
        CONFIGURATION_MOLLIE_API_KEY2: 'test_numbered',
      },
      async () => {
        expect(declared.credential('razorpay', 'keyId')).toBe('rzp_test_new')
        expect(core.credential('mollie', 'apiKey')).toBe('test_numbered')
      }
    )
  })

  it('never takes a longer field for a shorter one', async () => {
    await withEnv(
      {
        PAYPAL_CLIENT_ID: undefined,
        CONFIGURATION_PAYPAL_CLIENT_ID: undefined,
        CONFIGURATION_PAYPAL_CLIENT_SECRET: 'secret',
      },
      async () => {
        expect(core.credential('paypal', 'clientId')).toBe('')
      }
    )
  })

  it('converts money by the currency exponent', () => {
    expect(core.toMinor(19.99, 'eur')).toBe(1999)
    expect(core.toMinor(1500, 'JPY')).toBe(1500)
    expect(core.toMinor(1.2345, 'KWD')).toBe(1235)
    expect(core.toMinor(-1, 'USD')).toBe(0)
    expect(core.toMinor('abc', 'USD')).toBe(0)
    expect(core.fromMinor(1999, 'EUR')).toBe(19.99)
    expect(core.fromMinor(1235, 'BHD')).toBe(1.235)
    expect(core.decimalString(10, 'EUR')).toBe('10.00')
    expect(core.decimalString(10.005, 'KWD')).toBe('10.005')
    expect(core.decimalString(999.6, 'JPY')).toBe('1000')
  })

  it('encodes nested forms the way form-based APIs read them, and reads them back', () => {
    const encoded = core.formEncode({
      order_id: 'o 1',
      skip: null,
      shopper: { email: 'a@b.c' },
      items: [{ name: 'Mug & Co' }],
    })
    expect(encoded).toBe(
      'order_id=o%201&shopper%5Bemail%5D=a%40b.c&items%5B0%5D%5Bname%5D=Mug%20%26%20Co'
    )
    expect(core.parseForm('id=tr_1&note=a+b%21&empty=&flag&bad=%E0%A4%A')).toEqual({
      id: 'tr_1',
      note: 'a b!',
      empty: '',
      flag: '',
      bad: '%E0%A4%A',
    })
    expect(core.parseForm('')).toEqual({})
  })

  it('compares secrets in constant time and never matches an empty one', () => {
    expect(core.safeEqual('abc', 'abc')).toBe(true)
    expect(core.safeEqual('abc', 'abd')).toBe(false)
    expect(core.safeEqual('abc', 'abcd')).toBe(false)
    expect(core.safeEqual('', '')).toBe(false)
  })

  it('builds absolute URLs and this store’s webhook address', () => {
    expect(core.absoluteUrl('/pay/paddle', 'https://shop.test/')).toBe(
      'https://shop.test/pay/paddle'
    )
    expect(core.absoluteUrl('https://elsewhere.test/x', 'https://shop.test')).toBe(
      'https://elsewhere.test/x'
    )
    expect(core.absoluteUrl('/x', '')).toBe('/x')
    expect(core.webhookUrl('https://shop.test', 'mollie')).toBe(
      'https://shop.test/api/webhooks/mollie-payment'
    )
  })

  it('reads headers in any case, metadata in either shape, and errors by their message', () => {
    expect(core.header({ 'Paddle-Signature': 'ts=1' }, 'paddle-signature')).toBe('ts=1')
    expect(core.header({ 'x-a': ['first', 'second'] }, 'X-A')).toBe('first')
    expect(core.header(undefined, 'x')).toBe('')
    expect(core.readMetadata('{"orderId":"o1"}')).toEqual({ orderId: 'o1' })
    expect(core.readMetadata({ orderId: 'o1' })).toEqual({ orderId: 'o1' })
    expect(core.readMetadata('not json')).toEqual({})
    expect(core.describeError({ raw: { message: ' Card declined ' } })).toBe('Card declined')
    expect(core.describeError(null)).toBe('The payment provider could not be reached.')
  })
})
