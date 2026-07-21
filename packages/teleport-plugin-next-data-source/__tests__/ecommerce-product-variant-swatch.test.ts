import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

// The storefront variant picker gates a colour circle vs a text pill per VALUE
// on the enriched `showSwatch` string flag. This transform MUST mirror the
// renderer enrichment (packages/renderer/src/utils/ecommerce-products.ts) —
// otherwise the editor canvas shows colour circles but the generated Next.js app
// shows the colour name as text.

const evalBuildProduct = (): ((record: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() + '\n' + generateEcommerceProductTransformationCode()
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown) => Record<string, unknown>
}

interface VariantAxis {
  key: string
  name: string
  type: string
  values: Array<Record<string, unknown>>
}

const buildEcommerceProduct = evalBuildProduct()

const productWithAxes = () =>
  buildEcommerceProduct({
    id: 'p1',
    name: 'Tee',
    slug: 'tee',
    price: '20',
    currency: 'USD',
    variant_options: JSON.stringify([
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
        values: [
          { value: 'red', label: 'Red', color: '#ef4444' },
          { value: 'blue', label: 'Blue', color: '#3b82f6' },
          // A colour axis value WITHOUT a resolvable colour must degrade to a
          // text pill, never an invisible empty circle.
          { value: 'plain', label: 'Plain' },
        ],
      },
    ]),
  })

describe('ecommerce product transform — variant showSwatch string contract', () => {
  it('emits showSwatch "true" for colour-axis values that carry a colour', () => {
    const product = productWithAxes()
    const axes = product.variantOptions as VariantAxis[]
    const colour = axes.find((a) => a.key === 'color')!
    expect(colour.values[0].showSwatch).toBe('true')
    expect(colour.values[1].showSwatch).toBe('true')
  })

  it('emits showSwatch "false" for a colour value with no resolvable colour', () => {
    const product = productWithAxes()
    const axes = product.variantOptions as VariantAxis[]
    const colour = axes.find((a) => a.key === 'color')!
    expect(colour.values[2].showSwatch).toBe('false')
  })

  it('emits showSwatch "false" for every value of a text axis', () => {
    const product = productWithAxes()
    const axes = product.variantOptions as VariantAxis[]
    const size = axes.find((a) => a.key === 'size')!
    for (const v of size.values) {
      expect(v.showSwatch).toBe('false')
    }
  })

  it('always emits showSwatch as a STRING (never boolean/undefined)', () => {
    const product = productWithAxes()
    const axes = product.variantOptions as VariantAxis[]
    for (const axis of axes) {
      for (const v of axis.values) {
        expect(typeof v.showSwatch).toBe('string')
        expect(['true', 'false']).toContain(v.showSwatch)
      }
    }
  })
})
