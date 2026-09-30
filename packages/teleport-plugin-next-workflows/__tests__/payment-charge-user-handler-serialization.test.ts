import { paymentChargeUser } from '../src/nodes/payment/payment-charge-user'
import { generatePaymentCoreCode } from '../src/payments/payment-core-code'
import { evaluateEmittedModule } from './_helpers/load-invoice-route'

// A production bug once made every Stripe charge in a minified build fail
// with "Oo is not defined": the handler was assembled from several
// `.toString()`'d functions, and a minifier renamed a top-level currency list
// away from the name the serialized function referenced. The provider code
// now ships as STRING modules (`utils/payments/*.js`, see src/payments), which
// no minifier rewrites; these tests pin what is left of that hazard — the
// handler itself — and the money conversion the drivers share.
describe('payment-charge-user handler serialization', () => {
  const handlerSource = paymentChargeUser.generateHandler()

  it('produces syntactically valid, runnable JavaScript end-to-end', () => {
    // Evaluating the FULL concatenated source is what catches an orphaned
    // free-variable reference, exactly like requiring the generated segment.
    expect(() => new Function(handlerSource + '\nreturn payment_charge_user;')()).not.toThrow()
  })

  it('reads no environment and requires no module: providers are reached through the drivers', () => {
    expect(handlerSource).toContain('__paymentDrivers')
    expect(handlerSource).not.toContain('process')
    expect(handlerSource).not.toMatch(/\brequire\(/)
  })
})

describe('the drivers’ minor-unit conversion (utils/payments/core.js)', () => {
  const core = evaluateEmittedModule<{
    toMinor: (major: unknown, currency: string) => number
    fromMinor: (minor: unknown, currency: string) => number
    decimalString: (major: unknown, currency: string) => string
  }>(generatePaymentCoreCode(), require)

  it('converts a two-decimal currency to cents', () => {
    expect(core.toMinor(19.99, 'usd')).toBe(1999)
  })

  it('passes zero-decimal currencies through rounded, unmultiplied', () => {
    expect(core.toMinor(500, 'JPY')).toBe(500)
    expect(core.toMinor(500.6, 'jpy')).toBe(501)
  })

  it('multiplies three-decimal currencies by 1000', () => {
    expect(core.toMinor(1.5, 'BHD')).toBe(1500)
  })

  it('returns 0 for non-finite or non-positive amounts', () => {
    expect(core.toMinor(0, 'usd')).toBe(0)
    expect(core.toMinor(-5, 'usd')).toBe(0)
    expect(core.toMinor(NaN, 'usd')).toBe(0)
  })

  it('reads a provider amount back and prints one with the currency’s decimals', () => {
    expect(core.fromMinor(1999, 'usd')).toBe(19.99)
    expect(core.fromMinor(1500, 'BHD')).toBe(1.5)
    expect(core.decimalString(12.5, 'EUR')).toBe('12.50')
    expect(core.decimalString(12.5, 'JPY')).toBe('13')
    expect(core.decimalString(1.2345, 'KWD')).toBe('1.235')
  })
})
