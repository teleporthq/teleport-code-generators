import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { buildProductTransformOptions } from '../src/transformations'

/**
 * With backorders allowed (or stock management disabled) the merchant sells
 * past zero, so NOTHING in the storefront may present a product or a variant
 * combination as sold out:
 *
 *   - `outOfStock` stays 'false' even at quantity <= 0;
 *   - a zero-stock combination is NOT dead, IS default-selectable, and keeps
 *     `hasPurchasableVariant: 'true'` / a non-empty `defaultVariantId`;
 *   - a combination that does not exist at all is STILL unavailable — there
 *     is no variant row to backorder.
 *
 * The flag is baked at export time via
 * `EcommerceProductTransformOptions.allowBackorders`, resolved in ONE place
 * (`buildProductTransformOptions`) as: stock management off OR
 * `stockManagementConfig.allowBackorders` on.
 */

const evalBuildProduct = (
  allowBackorders: boolean
): ((r: unknown, o?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateEcommerceProductTransformationCode({ allowBackorders })
  return new Function(code + '\nreturn buildEcommerceProduct;')() as (
    r: unknown,
    o?: unknown
  ) => Record<string, unknown>
}

type Axis = { key: string; values: Array<Record<string, unknown>> }

const SIZE_AXIS = JSON.stringify([
  {
    key: 'size',
    name: 'Size',
    type: 'text',
    values: [
      { value: 'xs', label: 'XS' },
      { value: 's', label: 'S' },
    ],
  },
])

const variantProduct = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Tee',
  slug: 'tee',
  price: 20,
  currency: 'USD',
  variant_options: SIZE_AXIS,
  ...overrides,
})

const values = (product: Record<string, unknown>): Array<Record<string, unknown>> =>
  (product.variantOptions as Axis[])[0].values

describe('ecommerce product transform — allowBackorders', () => {
  const withBackorders = evalBuildProduct(true)
  const withoutBackorders = evalBuildProduct(false)

  it('a zero-quantity FLAT product is never out of stock with backorders', () => {
    const record = { id: 'f', name: 'Mug', slug: 'mug', price: 9, currency: 'USD', quantity: 0 }
    expect(withBackorders(record).outOfStock).toBe('false')
    expect(withoutBackorders(record).outOfStock).toBe('true')
  })

  it('a NEGATIVE quantity (already oversold) is still not out of stock', () => {
    const record = { id: 'f', name: 'Mug', slug: 'mug', price: 9, currency: 'USD', quantity: -3 }
    expect(withBackorders(record).outOfStock).toBe('false')
  })

  it('every combination sold out: values stay alive and purchasable with backorders', () => {
    const options = {
      variantsByProductId: {
        p1: [
          { id: 'v-xs', options: { size: 'xs' }, quantity: 0 },
          { id: 'v-s', options: { size: 's' }, quantity: 0 },
        ],
      },
    }
    const product = withBackorders(variantProduct(), options)
    expect(values(product).every((v) => v.isDead === 'false')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('true')
    // The first covering combination becomes the default selection again.
    expect(product.defaultVariantId).toBe('v-xs')

    // The strict build keeps its sold-out answer (regression guard for the
    // flag's default).
    const strict = withoutBackorders(variantProduct(), options)
    expect(strict.hasPurchasableVariant).toBe('false')
    expect(strict.defaultVariantId).toBe('')
  })

  it('a value with NO combination behind it stays dead even with backorders', () => {
    const product = withBackorders(variantProduct(), {
      variantsByProductId: { p1: [{ id: 'v-xs', options: { size: 'xs' }, quantity: 0 }] },
    })
    expect(values(product)[0].isDead).toBe('false')
    // 's' has no variant row — nothing exists to backorder.
    expect(values(product)[1].isDead).toBe('true')
  })

  it('looked up and there are NO combinations at all: still not purchasable', () => {
    const product = withBackorders(variantProduct(), { variantsByProductId: {} })
    expect(values(product).every((v) => v.isDead === 'true')).toBe(true)
    expect(product.hasPurchasableVariant).toBe('false')
  })

  it('omitting the option keeps the strict pre-flag behaviour', () => {
    const code =
      generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
    const build = new Function(code + '\nreturn buildEcommerceProduct;')() as (
      r: unknown
    ) => Record<string, unknown>
    expect(
      build({ id: 'f', name: 'Mug', slug: 'mug', price: 9, currency: 'USD', quantity: 0 })
        .outOfStock
    ).toBe('true')
  })
})

describe('buildProductTransformOptions — allowBackorders resolution', () => {
  const settings = (stockManagement: boolean, allowBackorders?: boolean) =>
    ({
      stockManagement,
      stockManagementConfig:
        allowBackorders === undefined ? null : { allowBackorders, lowStockThreshold: 5 },
    } as never)

  it('stock management ON + backorders ON → true', () => {
    expect(
      buildProductTransformOptions({ ecommerceSettings: settings(true, true) }).allowBackorders
    ).toBe(true)
  })

  it('stock management ON + backorders OFF → false', () => {
    expect(
      buildProductTransformOptions({ ecommerceSettings: settings(true, false) }).allowBackorders
    ).toBe(false)
  })

  it('stock management OFF → true regardless of the config block', () => {
    expect(
      buildProductTransformOptions({ ecommerceSettings: settings(false) }).allowBackorders
    ).toBe(true)
  })

  it('no e-commerce settings at all → false (strict default)', () => {
    expect(buildProductTransformOptions({}).allowBackorders).toBe(false)
  })
})
