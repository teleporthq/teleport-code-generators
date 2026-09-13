import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * The storefront variant picker and the visible-properties pills are gated on
 * fields this transform has to put on every product. When they were missing, the
 * picker worked on the editor canvas (whose own transform emitted them) and was
 * INVISIBLE in the deployed store — `requiresVariantSelection` came back
 * undefined, so the picker root's `=== 'true'` gate never matched.
 *
 * That failure is invisible from the editor by construction: a screenshot
 * showing the picker is the canvas, never the deployed store. This test is the
 * thing that can see it, so it asserts the whole gate contract rather than any
 * one field.
 */

const evalBuildProduct = (): ((record: unknown, options?: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown, options?: unknown) => Record<string, unknown>
}

const buildEcommerceProduct = evalBuildProduct()

const VARIANT_OPTIONS = [
  {
    key: 'size',
    name: 'Size',
    type: 'text',
    values: [
      { value: 's', label: 'S' },
      { value: 'm', label: 'M' },
    ],
  },
  {
    key: 'color',
    name: 'Colour',
    type: 'color',
    values: [{ value: 'red', label: 'Red', color: '#ef4444' }],
  },
]

// Combinations arrive from the batched lookup, keyed by product id — NOT from a
// column on the record.
const VARIANTS_BY_PRODUCT_ID = {
  p1: [
    { id: 'v-s-red', options: { size: 's', color: 'red' }, price: 25, quantity: 4 },
    { id: 'v-m-red', options: { size: 'm', color: 'red' }, price: 27, quantity: 0 },
  ],
}

const productWithVariants = () =>
  buildEcommerceProduct(
    {
      id: 'p1',
      name: 'Tee',
      slug: 'tee',
      price: '20',
      currency: 'USD',
      quantity: 4,
      metadata: JSON.stringify({ Material: 'Cotton' }),
      variant_options: JSON.stringify(VARIANT_OPTIONS),
    },
    { variantsByProductId: VARIANTS_BY_PRODUCT_ID }
  )

const productWithoutVariants = () =>
  buildEcommerceProduct(
    { id: 'p2', name: 'Mug', slug: 'mug', price: '10', currency: 'USD' },
    { variantsByProductId: {} }
  )

/**
 * Every field the generated storefront reads off a product to decide whether to
 * render the picker, which values are selectable, and what price to show.
 */
const PICKER_CONTRACT = [
  'variantOptions',
  'requiresVariantSelection',
  'variants',
  'variantOptionsJson',
  'variantsJson',
  'defaultVariantId',
  'defaultVariantPrice',
  'hasPurchasableVariant',
  'visibleProperties',
]

describe('ecommerce product transform — storefront picker contract', () => {
  it.each(PICKER_CONTRACT)('always emits %s, for a product WITH variants', (field) => {
    expect(productWithVariants()).toHaveProperty(field)
  })

  // The picker is hidden by absence, so a product with no variants must still
  // carry the keys — undefined and "false" are different bugs.
  it.each(PICKER_CONTRACT)('always emits %s, for a product WITHOUT variants', (field) => {
    expect(productWithoutVariants()).toHaveProperty(field)
  })

  it('gates the picker with the STRING "true"/"false", never a boolean', () => {
    expect(productWithVariants().requiresVariantSelection).toBe('true')
    expect(productWithoutVariants().requiresVariantSelection).toBe('false')
  })

  it('enriches every axis value with the per-value flags the picker reads', () => {
    const options = productWithVariants().variantOptions as Array<{
      key: string
      name: string
      values: Array<Record<string, unknown>>
    }>

    expect(options).toHaveLength(2)
    for (const axis of options) {
      expect(axis.name).toBeTruthy()
      for (const value of axis.values) {
        // Rendered label, colour-circle gate, and availability gate.
        expect(value).toHaveProperty('label')
        expect(value).toHaveProperty('showSwatch')
        expect(value).toHaveProperty('isDead')
        expect(['true', 'false']).toContain(value.showSwatch)
        expect(['true', 'false']).toContain(value.isDead)
      }
    }
  })

  it('ships the JSON companions the DOM-reading workflows parse', () => {
    const product = productWithVariants()

    // A data-* attribute bound to an array renders "[object Object]", so the
    // picker workflows read these stringified companions instead.
    expect(() => JSON.parse(product.variantOptionsJson as string)).not.toThrow()
    expect(() => JSON.parse(product.variantsJson as string)).not.toThrow()
    expect(JSON.parse(product.variantsJson as string)).toHaveLength(2)
  })

  it('preselects an in-stock combination', () => {
    const product = productWithVariants()

    expect(product.defaultVariantId).toBe('v-s-red')
    expect(product.hasPurchasableVariant).toBe('true')
  })

  it('surfaces custom metadata as visible properties', () => {
    expect(Array.isArray(productWithVariants().visibleProperties)).toBe(true)
  })
})
