import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

// AI-generated product cards/details pages check the outOfStock flag
// with strict string equality (`ecommerceProduct?.outOfStock === 'true'`).
// If the data-source transform emits a boolean, the comparison silently
// fails and the Add-to-Cart button stays visible on zero-stock products.
// This file pins the contract that `outOfStock` is always a string
// matching the AI's comparison form.

const evalBuildProduct = (): ((record: unknown) => Record<string, unknown>) => {
  // The emitted product transform calls helpers (`resolveI18nField`,
  // `pickFirst`, `normalizeTimestamp`) that live in the shared
  // transformation bundle, so we have to prepend that bundle before
  // evaluating. Matches the runtime, where both bundles ship together
  // into every data-source fetcher file.
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown) => Record<string, unknown>
}

describe('ecommerce product transform — outOfStock string contract', () => {
  const buildEcommerceProduct = evalBuildProduct()

  it('emits outOfStock as the STRING "true" when quantity is 0', () => {
    const product = buildEcommerceProduct({
      id: 'a',
      name: 'A',
      slug: 'a',
      price: '1',
      currency: 'USD',
      quantity: 0,
    })
    expect(product.outOfStock).toBe('true')
    // Strict equality with 'true' is what the AI emits on product cards;
    // this assertion guards against silent regression to boolean.
    expect(product.outOfStock === 'true').toBe(true)
  })

  it('emits outOfStock as the STRING "false" when quantity is positive', () => {
    const product = buildEcommerceProduct({
      id: 'b',
      name: 'B',
      slug: 'b',
      price: '1',
      currency: 'USD',
      quantity: 10,
    })
    expect(product.outOfStock).toBe('false')
    expect(product.outOfStock === 'true').toBe(false)
  })

  it('emits outOfStock as "false" when quantity is null (unlimited stock)', () => {
    const product = buildEcommerceProduct({
      id: 'c',
      name: 'C',
      slug: 'c',
      price: '1',
      currency: 'USD',
      quantity: null,
    })
    // Null/NaN means unlimited stock — never out of stock.
    expect(product.outOfStock).toBe('false')
  })

  it('emits outOfStock as "false" when quantity is undefined', () => {
    const product = buildEcommerceProduct({
      id: 'd',
      name: 'D',
      slug: 'd',
      price: '1',
      currency: 'USD',
    })
    expect(product.outOfStock).toBe('false')
  })

  it('emits outOfStock as the STRING "true" when quantity is negative', () => {
    // Defensive — should never happen in practice with stock-management
    // enforcing >= 0, but if it does we want the same "out of stock"
    // treatment.
    const product = buildEcommerceProduct({
      id: 'e',
      name: 'E',
      slug: 'e',
      price: '1',
      currency: 'USD',
      quantity: -1,
    })
    expect(product.outOfStock).toBe('true')
  })

  it('always returns a STRING for outOfStock (never boolean)', () => {
    // Iterate through all the quantity shapes the transform might see
    // and assert the type. This is the regression guard — a future
    // refactor that drops the `? 'true' : 'false'` ternary would fail
    // every assertion here.
    const cases = [0, 1, 10, null, undefined, '0', '3', '', NaN]
    for (const q of cases) {
      const product = buildEcommerceProduct({
        id: 'x',
        name: 'X',
        slug: 'x',
        price: '1',
        currency: 'USD',
        quantity: q,
      })
      expect(typeof product.outOfStock).toBe('string')
      expect(['true', 'false']).toContain(product.outOfStock)
    }
  })
})
