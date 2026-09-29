import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { buildProductTransformOptions } from '../src/transformations'
import type { UIDLEcommerceProductPages } from '@teleporthq/teleport-types'
import fixtures from './product-page-url-fixtures.json'

/**
 * Custom product pages: with `ecommerceSettings.productPages` baked in, every
 * product carries `productPageKey` (the page it opens on, '' = the standard
 * one) and `productPageUrl` (its canonical address) — the product pages'
 * guarded redirect and every product link read them. Without it the transform
 * is exactly what it was. The addresses are pinned against the GUI's own
 * builder by the SAME fixture file (`product-page-url-fixtures.json`, a copy of
 * the GUI's `utils/product-pages/__tests__/fixtures/` one).
 */

type BuildProduct = (record: unknown, options?: unknown) => Record<string, unknown>

const evalBuildProduct = (productPages?: UIDLEcommerceProductPages): BuildProduct => {
  const code =
    generateSharedTransformationCode() +
    '\n' +
    generateEcommerceProductTransformationCode({ productPages })
  return new Function(code + '\nreturn buildEcommerceProduct;')() as BuildProduct
}

const PRODUCT = { id: '7', name: 'Mug', slug: 'mug', price: 12, currency: 'USD' }

describe('ecommerce product transform — product pages', () => {
  it('adds nothing to a store without custom product pages', () => {
    const code = generateEcommerceProductTransformationCode({})
    expect(code).not.toContain('PRODUCT_PAGES')
    expect(code).not.toContain('productPageUrl')
    const product = evalBuildProduct()({ ...PRODUCT, product_page: 'personalise' })
    expect(product).not.toHaveProperty('productPageKey')
    expect(product).not.toHaveProperty('productPageUrl')
  })

  it("builds every product's page and address exactly as the GUI does", () => {
    const build = evalBuildProduct(fixtures.config as UIDLEcommerceProductPages)
    for (const fixture of fixtures.cases) {
      const product = build({
        ...PRODUCT,
        ...fixture.values,
        product_page: fixture.raw,
      })
      expect({
        name: fixture.name,
        key: product.productPageKey,
        url: product.productPageUrl,
      }).toEqual({
        name: fixture.name,
        key: fixture.key,
        url: fixture.url,
      })
    }
  })

  it('reads the camel-cased column a non-SQL source hands back', () => {
    const build = evalBuildProduct(fixtures.config as UIDLEcommerceProductPages)
    const product = build({ ...PRODUCT, slug: 'postcard', productPage: 'personalise' })
    expect(product.productPageUrl).toBe('/personalise/postcard')
  })

  it('bakes routes only — a page name never reaches the site', () => {
    const code = generateEcommerceProductTransformationCode({
      productPages: fixtures.config as UIDLEcommerceProductPages,
    })
    expect(code).not.toContain('Personalise')
    // The helpers add no backtick: the transform is spliced into template literals.
    const backticks = (text: string) => text.split('`').length
    expect(backticks(code)).toBe(backticks(generateEcommerceProductTransformationCode({})))
  })

  it('takes the config from the exported e-commerce settings', () => {
    const options = buildProductTransformOptions({
      ecommerceSettings: { productPages: fixtures.config },
    } as never)
    expect(options.productPages).toEqual(fixtures.config)
    expect(buildProductTransformOptions({} as never).productPages).toBeUndefined()
  })
})
