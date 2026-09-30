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

/**
 * Every field the generated product page reads to say what buying a product
 * MEANS — the "Purchase details" block and the price-row pills. Strings where
 * a rendering condition gates on them; the block is hidden by absence, so a
 * plain one-time product must still carry every key.
 */
const PURCHASE_DETAILS_CONTRACT = [
  'billingPeriod',
  'billingSummary',
  'trialDays',
  'recurringIntervalCount',
  'isDigital',
  'isGiftCard',
]

const subscriptionPlan = (over: Record<string, unknown>) =>
  buildEcommerceProduct(
    {
      id: 'p3',
      name: 'Plan',
      slug: 'plan',
      price: '12',
      currency: 'USD',
      payment_type: 'recurring',
      recurring_interval: 'month',
      ...over,
    },
    { variantsByProductId: {} }
  )

describe('ecommerce product transform — storefront purchase-details contract', () => {
  it.each(PURCHASE_DETAILS_CONTRACT)('always emits %s, for a product WITH variants', (field) => {
    expect(productWithVariants()).toHaveProperty(field)
  })

  it.each(PURCHASE_DETAILS_CONTRACT)('always emits %s, for a product WITHOUT variants', (field) => {
    expect(productWithoutVariants()).toHaveProperty(field)
  })

  it('says nothing about billing, a download or a gift card on a plain one-time product', () => {
    expect(productWithoutVariants()).toMatchObject({
      billingSummary: '',
      trialDays: 0,
      isDigital: 'false',
      isGiftCard: 'false',
    })
  })

  it('prints the billing sentence of a subscription, with its free trial when it has one', () => {
    expect(subscriptionPlan({ recurring_interval_count: '3', trial_days: '14' })).toMatchObject({
      billingPeriod: '3 months',
      billingSummary: 'Billed every 3 months · 14-day free trial',
      trialDays: 14,
      recurringIntervalCount: 3,
    })
    // NULL / zero columns read as "every month, no trial" — and the count the
    // schedule is built from is never below 1 on a subscription.
    for (const over of [
      { recurring_interval_count: null, trial_days: null },
      { recurring_interval_count: 0, trial_days: 0 },
      { recurring_interval_count: 'x', trial_days: -3 },
    ]) {
      expect(subscriptionPlan(over)).toMatchObject({
        billingPeriod: 'month',
        billingSummary: 'Billed every month',
        trialDays: 0,
        recurringIntervalCount: 1,
      })
    }
  })

  it('gates the gift-card pill with the STRING "true"/"false", however the column is spelled', () => {
    for (const raw of [true, 't', 'true', 1, '1']) {
      expect(
        buildEcommerceProduct({ id: 'g', name: 'G', price: '5', is_gift_card: raw }).isGiftCard
      ).toBe('true')
    }
    for (const raw of [false, 'f', 'false', 0, '0', null, undefined, '']) {
      expect(
        buildEcommerceProduct({ id: 'g', name: 'G', price: '5', is_gift_card: raw }).isGiftCard
      ).toBe('false')
    }
  })
})

/**
 * Every field the generated product page and cards read to draw product
 * options: the configurator, the configured price, the card's quick-add gate
 * and the buy button's attributes. A listing and a product without options
 * carry the EMPTY values — a binding to an absent field renders undefined, and
 * the configurator's gates would read that as a configured product.
 */
const OPTIONS_CONTRACT = [
  'hasProductOptions',
  'optionsRequireInput',
  'optionsQuickAdd',
  'optionGroups',
  'optionGroupsJson',
  'optionsPricingJson',
  'optionsDefaultDisplayPrice',
  'optionsDefaultOriginalDisplayPrice',
  'optionsDefaultSummary',
  'optionsFreshKey',
  'optionsValidKey',
  'optionsOriginalKey',
  'optionsSummaryKey',
  'optionsFilesKey',
]

const OPTION_GROUP_CONTRACT = [
  'id',
  'key',
  'label',
  'helpText',
  'placeholder',
  'unit',
  'required',
  'isChoice',
  'isMulti',
  'isText',
  'isLongText',
  'isNumber',
  'isToggle',
  'isUpload',
  'isButtons',
  'isSwatches',
  'isCards',
  'isSelectable',
  'isInput',
  'initiallyVisible',
  'cellRole',
  'rowRole',
  'rowRequired',
  'idleTabIndex',
  'inputType',
  'inputMode',
  'maxLengthText',
  'minText',
  'maxText',
  'stepText',
  'defaultValueText',
  'rangeHint',
  'acceptKind',
  'acceptMime',
  'priceVariants',
  'headerPriceVariants',
  'hiddenKey',
  'shownKey',
  'missingKey',
  'invalidKey',
  'rejectedKey',
  'failedKey',
  'uploadedKey',
  'uploadingKey',
  'freshKey',
  'values',
]

const OPTION_VALUE_CONTRACT = [
  'id',
  'key',
  'label',
  'description',
  'color',
  'imageUrl',
  'isDefault',
  'showSwatch',
  'showImage',
  'selectedKey',
  'freshKey',
  'priceVariants',
]

const OPTION_GROUPS = [
  {
    key: 'size',
    label: 'Size',
    type: 'choice',
    required: true,
    values: [
      { key: 'a5', label: 'A5', price: { mode: 'none' }, default: true },
      { key: 'a3', label: 'A3', price: { mode: 'fixed', amount: 9 } },
    ],
  },
  { key: 'gift-wrap', label: 'Gift wrap', type: 'toggle', price: { mode: 'fixed', amount: 2 } },
  { key: 'engraving', label: 'Engraving', type: 'text', maxLength: 20 },
]

const configurableProduct = (includeOptionDetail: boolean) =>
  buildEcommerceProduct(
    {
      id: 'p4',
      name: 'Lighter',
      slug: 'lighter',
      price: '30',
      currency: 'USD',
      option_groups: JSON.stringify(OPTION_GROUPS),
    },
    { variantsByProductId: {}, includeOptionDetail }
  )

describe('ecommerce product transform — storefront product-options contract', () => {
  it.each(OPTIONS_CONTRACT)('always emits %s, for a product WITH variants', (field) => {
    expect(productWithVariants()).toHaveProperty(field)
  })

  it.each(OPTIONS_CONTRACT)('always emits %s, for a product WITHOUT variants', (field) => {
    expect(productWithoutVariants()).toHaveProperty(field)
  })

  it.each(OPTIONS_CONTRACT)('always emits %s, for a configurable product in a listing', (field) => {
    expect(configurableProduct(false)).toHaveProperty(field)
  })

  it('gates with the STRING flags, never booleans', () => {
    expect(productWithoutVariants()).toMatchObject({
      hasProductOptions: 'false',
      optionsRequireInput: 'false',
      optionsQuickAdd: 'true',
    })
    expect(configurableProduct(false)).toMatchObject({
      hasProductOptions: 'true',
      optionsRequireInput: 'false',
      optionsQuickAdd: 'true',
    })
  })

  it('enriches every group and value with the fields the configurator binds', () => {
    const groups = configurableProduct(true).optionGroups as Array<Record<string, unknown>>
    expect(groups).toHaveLength(3)
    for (const group of groups) {
      for (const field of OPTION_GROUP_CONTRACT) {
        expect(group).toHaveProperty(field)
      }
      for (const value of group.values as Array<Record<string, unknown>>) {
        for (const field of OPTION_VALUE_CONTRACT) {
          expect(value).toHaveProperty(field)
        }
      }
    }
  })

  it('keys every repeater row by the product, so typed text never follows the shopper', () => {
    const [size, wrap] = configurableProduct(true).optionGroups as Array<{
      id: string
      values: Array<{ id: string }>
    }>
    expect(size.id).toBe('p4|size')
    expect(size.values.map((value) => value.id)).toEqual(['p4|size|a5', 'p4|size|a3'])
    expect(wrap.values.map((value) => value.id)).toEqual(['p4|gift-wrap|on'])
  })

  it('ships the JSON companions the configurator workflows parse', () => {
    const product = configurableProduct(true)
    expect(JSON.parse(product.optionGroupsJson as string)).toHaveLength(3)
    expect(JSON.parse(product.optionsPricingJson as string)).toMatchObject({
      productId: 'p4',
      netBase: 30,
      pricesDisabled: false,
    })
  })

  // ARIA allows aria-required on a radiogroup, not on a group: a required
  // pick-several row carrying it fails axe and Lighthouse (aria-allowed-attr).
  it('lets only a pick-one row say it is required, with null (never undefined) elsewhere', () => {
    const extras = {
      key: 'extras',
      label: 'Extras',
      type: 'multi-choice',
      required: true,
      values: [{ key: 'ribbon', label: 'Ribbon', price: { mode: 'none' } }],
    }
    const product = buildEcommerceProduct(
      {
        id: 'p5',
        name: 'Hamper',
        slug: 'hamper',
        price: '40',
        currency: 'USD',
        option_groups: JSON.stringify([...OPTION_GROUPS, extras]),
      },
      { variantsByProductId: {}, includeOptionDetail: true }
    )
    const groups = product.optionGroups as Array<Record<string, unknown>>
    expect(groups.map((group) => [group.key, group.rowRole, group.rowRequired])).toEqual([
      ['size', 'radiogroup', 'true'],
      ['gift-wrap', 'group', null],
      ['engraving', 'group', null],
      ['extras', 'group', null],
    ])
  })
})
