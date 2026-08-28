import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { buildProductTransformOptions } from '../src/transformations'
import type { UIDLInvoiceSettings } from '@teleporthq/teleport-types'

// The storefront quotes tax-inclusive prices when the merchant picked
// "Added on top", but `teleport_products.price` stays NET — it is what the
// merchant typed, what the admin panel edits, and what the invoice route
// re-derives VAT from. The transform therefore emits SEPARATE display fields
// and must never move `price` itself.

const evalBuildProduct = (
  storefrontTaxRate: number
): ((record: unknown) => Record<string, unknown>) => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateEcommerceProductTransformationCode({ storefrontTaxRate })
  const fn = new Function(code + '\nreturn buildEcommerceProduct;')
  return fn() as (record: unknown) => Record<string, unknown>
}

const FLAT_PRODUCT = { id: 'p1', name: 'P', slug: 'p', price: '19.99', currency: 'USD' }

const invoiceSettings = (over: Partial<UIDLInvoiceSettings>): UIDLInvoiceSettings =>
  ({ defaultTaxRate: 0, taxIncludedInPrice: false, ...over } as UIDLInvoiceSettings)

describe('ecommerce product transform — storefront tax display fields', () => {
  it('leaves `price` NET and adds a gross `displayPrice`', () => {
    const product = evalBuildProduct(19)(FLAT_PRODUCT)
    expect(product.price).toBe(19.99)
    expect(product.displayPrice).toBe('23.79')
  })

  it('is a formatting-only no-op at rate 0 — the number is untouched', () => {
    const product = evalBuildProduct(0)(FLAT_PRODUCT)
    expect(product.price).toBe(19.99)
    expect(product.displayPrice).toBe('19.99')
  })

  it('always emits two decimals, so a trailing-zero price never renders as "19.9"', () => {
    const product = evalBuildProduct(0)({ ...FLAT_PRODUCT, price: '19.90' })
    expect(product.displayPrice).toBe('19.90')
  })

  it('rounds per UNIT, so unit x quantity equals the line total the cart prints', () => {
    const product = evalBuildProduct(19)(FLAT_PRODUCT)
    expect(Number(product.displayPrice) * 3).toBeCloseTo(71.37, 5)
  })

  it('grosses the default variant price and the picker JSON, leaving their net twins alone', () => {
    const record = {
      ...FLAT_PRODUCT,
      variant_options: JSON.stringify([
        { key: 'size', name: 'Size', type: 'text', values: [{ value: 's', label: 'S' }] },
      ]),
    }
    const withVariants = new Function(
      generateSharedTransformationCode() +
        '\n' +
        generateEcommerceProductTransformationCode({ storefrontTaxRate: 19 }) +
        '\nreturn buildEcommerceProduct;'
    )() as (r: unknown, o: unknown) => Record<string, unknown>

    const product = withVariants(record, {
      variantsByProductId: {
        // `price: null` INHERITS the product price — the gross copy has to
        // resolve the inheritance before taxing, or an inheriting combination
        // would show the net base price beside an overriding gross one.
        p1: [
          { id: 'v1', options: { size: 's' }, price: null, quantity: 5 },
          { id: 'v2', options: { size: 'm' }, price: '30.00', quantity: 5 },
        ],
      },
    })

    expect(product.defaultVariantPrice).toBe('19.99')
    expect(product.defaultVariantDisplayPrice).toBe('23.79')

    const net = JSON.parse(String(product.variantsJson))
    const gross = JSON.parse(String(product.variantsDisplayJson))
    expect(net[0].price).toBeNull()
    expect(net[1].price).toBe(30)
    expect(gross[0].price).toBe(23.79)
    expect(gross[1].price).toBe(35.7)
    // Everything except the price rides through untouched — the picker resolves
    // the selected combination by id and gates on quantity.
    expect(gross[0].id).toBe('v1')
    expect(gross[0].options).toEqual({ size: 's' })
    expect(gross[0].quantity).toBe(5)
  })

  it('tolerates a missing / unparseable price', () => {
    const build = evalBuildProduct(19)
    expect(build({ id: 'x', name: 'X', slug: 'x' }).displayPrice).toBe('0.00')
    expect(build({ id: 'x', name: 'X', slug: 'x', price: 'abc' }).displayPrice).toBe('0.00')
  })
})

describe('buildProductTransformOptions', () => {
  it('resolves the rate from the invoice settings and carries the taxonomy through', () => {
    const options = buildProductTransformOptions({
      ecommerceSettings: { categories: [{ id: 'c1', name: 'C', slug: 'c' }] } as never,
      invoiceSettings: invoiceSettings({ defaultTaxRate: 21 }),
    })
    expect(options.storefrontTaxRate).toBe(21)
    expect(options.categories).toHaveLength(1)
  })

  it('is 0 for tax-inclusive pricing and for a store with no invoice settings at all', () => {
    expect(
      buildProductTransformOptions({
        invoiceSettings: invoiceSettings({ defaultTaxRate: 19, taxIncludedInPrice: true }),
      }).storefrontTaxRate
    ).toBe(0)
    expect(buildProductTransformOptions({}).storefrontTaxRate).toBe(0)
  })
})
