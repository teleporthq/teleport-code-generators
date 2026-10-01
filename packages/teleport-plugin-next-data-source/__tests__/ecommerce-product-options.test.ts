import { readFileSync } from 'fs'
import { join } from 'path'
import { ProductDiscounts, ProductOptions } from '@teleporthq/teleport-shared'
import { getTransformWrapperCode } from '../src/transformations'
import { generateEcommerceProductTransformationCode } from '../src/transformations/ecommerce-product'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'

/**
 * Product options in the GENERATED storefront transform. The fixture is a
 * byte-for-byte copy of the GUI's
 * `features/e-commerce/utils/product-options/__tests__/fixtures/product-options-storefront.fixture.json`,
 * which the canvas transform (`packages/renderer/src/utils/ecommerce-products.ts`)
 * runs in `ecommerce-products-options.test.ts`: both transforms must emit
 * exactly these fields, or the configurator, the configured price and the
 * card's quick-add gate differ between the editor and the published store.
 */

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

interface FixtureCase {
  name: string
  includeDetail: boolean
  taxRate: number
  currentLanguage: string | null
  mainLanguage: string | null
  variants: Array<Record<string, unknown>> | null
  record: Record<string, unknown>
  expected: Record<string, unknown>
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(join(__dirname, file), 'utf8'))

const FIXTURE = readJson<{ cases: FixtureCase[] }>('product-options-storefront.fixture.json')
const PRE_OPTIONS_GOLDEN = readJson<{
  records: Array<Record<string, unknown>>
  variantsByProductId: Record<string, unknown>
  assetMap: Record<string, unknown>
  storefrontTaxRate: number
  expected: Array<Record<string, unknown>>
}>('ecommerce-product-pre-options.golden.json')

const transformCode = (storefrontTaxRate: number): string =>
  generateSharedTransformationCode() +
  '\n' +
  generateEcommerceProductTransformationCode({ storefrontTaxRate })

const buildProduct = (storefrontTaxRate: number): Build =>
  new Function(transformCode(storefrontTaxRate) + '\nreturn buildEcommerceProduct;')() as Build

const OPTION_FIELDS = Object.keys(FIXTURE.cases[0].expected)

const pickOptionFields = (product: Record<string, unknown>) =>
  OPTION_FIELDS.reduce<Record<string, unknown>>((picked, field) => {
    picked[field] = product[field]
    return picked
  }, {})

const withoutOptionFields = (product: Record<string, unknown>) =>
  Object.keys(product)
    .filter((field) => OPTION_FIELDS.indexOf(field) === -1)
    .reduce<Record<string, unknown>>((kept, field) => {
      kept[field] = product[field]
      return kept
    }, {})

const EMPTY_OPTION_FIELDS = FIXTURE.cases.find(
  (entry) => entry.name === 'a product without options'
)?.expected as Record<string, unknown>

const PRINT_GROUPS = [
  {
    key: 'paper',
    label: 'Paper',
    type: 'choice',
    display: 'cards',
    required: true,
    values: [
      {
        key: 'matte',
        label: 'Matte',
        price: { mode: 'none' },
        default: true,
        imageUrl: 'TQ_matte',
      },
    ],
  },
]

describe('product transform — product options fixture (shared with the canvas)', () => {
  it.each(FIXTURE.cases.map((entry) => [entry.name, entry] as [string, FixtureCase]))(
    '%s',
    (_name, entry) => {
      const product = buildProduct(entry.taxRate)(entry.record, {
        assetMap: {},
        currentLanguage: entry.currentLanguage,
        mainLanguage: entry.mainLanguage,
        variantsByProductId: entry.variants ? { [String(entry.record.id)]: entry.variants } : null,
        includeOptionDetail: entry.includeDetail,
      })
      expect(pickOptionFields(product)).toEqual(entry.expected)
    }
  )
})

describe('product transform — products without options are unchanged', () => {
  it.each([false, true])(
    'equals the pre-options output plus empty fields (detail: %s)',
    (detail) => {
      const build = buildProduct(PRE_OPTIONS_GOLDEN.storefrontTaxRate)
      PRE_OPTIONS_GOLDEN.records.forEach((record, index) => {
        const product = build(record, {
          assetMap: PRE_OPTIONS_GOLDEN.assetMap,
          currentLanguage: null,
          mainLanguage: null,
          variantsByProductId: PRE_OPTIONS_GOLDEN.variantsByProductId,
          ratingsByProductId: {},
          reviewsByProductId: {},
          includeOptionDetail: detail,
        })
        expect(JSON.parse(JSON.stringify(withoutOptionFields(product)))).toEqual(
          PRE_OPTIONS_GOLDEN.expected[index]
        )
        expect(pickOptionFields(product)).toEqual(EMPTY_OPTION_FIELDS)
      })
    }
  )
})

describe('product transform — option detail wiring', () => {
  const record = { id: 'p1', name: 'Print', price: 10, option_groups: JSON.stringify(PRINT_GROUPS) }

  it('resolves a value image stored as an asset id through the asset map', () => {
    const product = buildProduct(0)(record, {
      assetMap: { TQ_matte: { remoteSrc: 'https://cdn.example.com/matte.jpg' } },
      includeOptionDetail: true,
    })
    const groups = product.optionGroups as Array<{ values: Array<Record<string, unknown>> }>
    expect(groups[0].values[0]).toMatchObject({
      imageUrl: 'https://cdn.example.com/matte.jpg',
      showImage: 'true',
    })
  })

  it('never hands a related product the option detail', () => {
    const parent = buildProduct(0)(
      { id: 'p0', name: 'Frame', price: 5, related_product_ids: '["p1"]' },
      { includeOptionDetail: true, relatedProductsById: { p1: record } }
    )
    const [related] = parent.relatedProducts as Array<Record<string, unknown>>
    expect(related.hasProductOptions).toBe('true')
    expect(related.optionGroups).toEqual([])
    expect(related.optionsPricingJson).toBe('{}')
  })

  it('splices the options helpers right after the discount helpers', () => {
    const code = generateEcommerceProductTransformationCode({})
    const discounts = code.indexOf(ProductDiscounts.generateProductDiscountHelperCode())
    const options = code.indexOf(ProductOptions.generateProductOptionsHelperCode())
    expect(discounts).toBeGreaterThan(-1)
    expect(options).toBe(
      discounts + ProductDiscounts.generateProductDiscountHelperCode().length + 1
    )
  })
})

describe('transform wrapper — option detail on the single-record fetch only', () => {
  // Every lookup fails (no database): the maps fall back to their "unknown" or
  // empty answers, which is all the transform needs here.
  const offline = () => ({
    connect: () => Promise.reject(new Error('offline')),
    query: () => Promise.reject(new Error('offline')),
    end: () => Promise.resolve(),
  })
  const transformRecords = new Function(
    transformCode(0) +
      '\n' +
      getTransformWrapperCode('teleport_products') +
      '\nreturn transformRecords;'
  )() as (
    records: unknown[],
    getClient: () => unknown,
    query: Record<string, unknown>
  ) => Promise<Array<Record<string, unknown>>>

  const product = (id: string) => ({
    id,
    name: id,
    price: 10,
    option_groups: JSON.stringify(PRINT_GROUPS),
  })

  it('emits the detail for the details page', async () => {
    const [details] = await transformRecords([product('p1')], offline, {})
    expect((details.optionGroups as unknown[]).length).toBe(1)
    expect(details.optionsFreshKey).toBe('fresh:p1')
  })

  it('keeps a listing to the flags', async () => {
    const listing = await transformRecords([product('p1'), product('p2')], offline, {})
    for (const card of listing) {
      expect(card.hasProductOptions).toBe('true')
      expect(card.optionGroups).toEqual([])
      expect(card.optionGroupsJson).toBe('[]')
    }
  })
})
