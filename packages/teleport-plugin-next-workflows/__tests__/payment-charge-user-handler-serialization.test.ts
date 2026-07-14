import { paymentChargeUser } from '../src/nodes/payment/payment-charge-user'

// Regression coverage for a production bug: clicking "Pay Now" on a
// Stripe checkout failed with
//   { "success": false, "error": "Oo is not defined", "provider": "stripe" }
//
// Root cause: `generateHandler()` builds the final server-route handler by
// calling `.toString()` on several TypeScript functions independently and
// concatenating the source text (see `../src/nodes/types.ts`'s
// `handlerToString` docs). Two currency-code arrays
// (STRIPE_ZERO_DECIMAL_CURRENCIES / STRIPE_THREE_DECIMAL_CURRENCIES) used
// to be declared as top-level consts and referenced from inside
// `toStripeMinorUnits`. That's fine in an unminified build, but this
// package is itself bundled + minified by consumers (teleport-gui's
// browser packer, via webpack/Terser) before `generateHandler()` ever
// runs — the minifier is free to rename an unused-by-name top-level
// const (nothing calls it by string, only a runtime `.toString()` read
// does, which the minifier can't see), and it renamed the declaration
// away from what the reconstructed `var STRIPE_ZERO_DECIMAL_CURRENCIES =
// [...]` text in `generateHandler()` assumed. The result: the generated
// workflow segment file declared the array under the ORIGINAL name but
// `toStripeMinorUnits`'s serialized body referenced the MINIFIER-RENAMED
// name (e.g. a mangled `Oo`), which was never declared anywhere in the
// generated file — a `ReferenceError` the first time a Stripe charge ran
// with a zero- or three-decimal currency.
//
// The fix moves both arrays to be declared LOCAL to `toStripeMinorUnits`
// so the declaration and every reference to it live in the SAME
// `.toString()` snapshot — a consistent rename can never separate them.
describe('payment-charge-user handler serialization survives minification-style renaming', () => {
  const handlerSource = paymentChargeUser.generateHandler()

  it('does not reference the old top-level currency-array identifiers anywhere', () => {
    // These names no longer exist ANYWHERE in the source — not as a
    // declaration, not as a reference. If a future edit reintroduces a
    // top-level const referenced only from inside a separately
    // `.toString()`'d function, this is the shape of bug that comes back.
    expect(handlerSource).not.toContain('STRIPE_ZERO_DECIMAL_CURRENCIES')
    expect(handlerSource).not.toContain('STRIPE_THREE_DECIMAL_CURRENCIES')
  })

  it('declares the currency arrays INSIDE toStripeMinorUnits, not reconstructed separately', () => {
    const fnStart = handlerSource.indexOf('function toStripeMinorUnits')
    expect(fnStart).toBeGreaterThan(-1)
    // The next function declaration marks the end of toStripeMinorUnits's
    // body (functions are concatenated back-to-back by generateHandler()).
    const nextFnStart = handlerSource.indexOf('function chargeWithStripe', fnStart)
    expect(nextFnStart).toBeGreaterThan(fnStart)
    const body = handlerSource.slice(fnStart, nextFnStart)
    expect(body).toContain('JPY')
    expect(body).toContain('BHD')
  })

  it('produces syntactically valid, runnable JavaScript end-to-end', () => {
    // Evaluating the FULL concatenated handler source (not just one
    // function in isolation) is what actually catches an orphaned
    // free-variable reference — exactly like requiring the generated
    // workflow segment .js file would in production.
    expect(() => new Function(handlerSource + '\nreturn payment_charge_user;')()).not.toThrow()
  })

  describe('toStripeMinorUnits — extracted from the serialized handler source', () => {
    const toStripeMinorUnits = (() => {
      const fnStart = handlerSource.indexOf('function toStripeMinorUnits')
      const nextFnStart = handlerSource.indexOf('function chargeWithStripe', fnStart)
      const body = handlerSource.slice(fnStart, nextFnStart)
      return new Function(body + '\nreturn toStripeMinorUnits;')() as (
        major: unknown,
        currency: string
      ) => number
    })()

    it('converts a standard (2-decimal) currency to minor units', () => {
      expect(toStripeMinorUnits(19.99, 'usd')).toBe(1999)
    })

    it('passes zero-decimal currencies through rounded, unmultiplied', () => {
      // This is the exact code path that threw "Oo is not defined" in
      // production — a JPY (zero-decimal) charge.
      expect(toStripeMinorUnits(500, 'JPY')).toBe(500)
      expect(toStripeMinorUnits(500.6, 'jpy')).toBe(501)
    })

    it('multiplies three-decimal currencies by 1000', () => {
      expect(toStripeMinorUnits(1.5, 'BHD')).toBe(1500)
    })

    it('returns 0 for non-finite or non-positive amounts', () => {
      expect(toStripeMinorUnits(0, 'usd')).toBe(0)
      expect(toStripeMinorUnits(-5, 'usd')).toBe(0)
      expect(toStripeMinorUnits(NaN, 'usd')).toBe(0)
    })
  })
})
