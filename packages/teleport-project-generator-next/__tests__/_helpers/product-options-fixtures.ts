import { ProductOptions } from '@teleporthq/teleport-shared'

/**
 * The worked print example of the product options feature, as the storefront
 * runtime meets it: a $10 print, Size A5 +0 / A4 +4 / A3 +9, Glossy priced by
 * Size (A5 +3, A4 +5, A3 +8, otherwise +2), Fine-art +40% of the charged base,
 * and the shopper's photo. A3 + Glossy is $27.
 */

const NONE = { mode: 'none' }

export const PRINT_GROUPS = [
  {
    key: 'size',
    label: 'Size',
    type: 'choice',
    required: true,
    display: 'buttons',
    values: [
      { key: 'a5', label: 'A5', price: NONE },
      { key: 'a4', label: 'A4', price: { mode: 'fixed', amount: 4 } },
      { key: 'a3', label: 'A3', price: { mode: 'fixed', amount: 9 } },
    ],
  },
  {
    key: 'paper',
    label: 'Paper',
    type: 'choice',
    required: true,
    display: 'cards',
    values: [
      { key: 'matte', label: 'Matte', price: NONE },
      {
        key: 'glossy',
        label: 'Glossy',
        price: { mode: 'fixed', amount: 2 },
        priceWhen: [
          { groupKey: 'size', valueKeys: ['a5'], price: { mode: 'fixed', amount: 3 } },
          { groupKey: 'size', valueKeys: ['a4'], price: { mode: 'fixed', amount: 5 } },
          { groupKey: 'size', valueKeys: ['a3'], price: { mode: 'fixed', amount: 8 } },
        ],
      },
      { key: 'fine-art', label: 'Fine-art', price: { mode: 'percent', percent: 40 } },
    ],
  },
  {
    key: 'your-photo',
    label: 'Your photo',
    type: 'upload',
    required: false,
    price: NONE,
    accept: 'image',
    maxFiles: 1,
  },
]

export const PHOTO = {
  id: 'a1_b2-c3.d4',
  name: 'IMG_2231.jpg',
  size: 204800,
  url: 'https://files.example.com/uploads/a1_b2-c3.d4.jpg',
  mimeType: 'image/jpeg',
}

export interface ProductOptionsRuntime {
  canonical: (entries: unknown) => string
  key: (entries: unknown) => string
}

/** The storefront's own canonical-string and key functions. */
export const productOptionsRuntime = (): ProductOptionsRuntime =>
  new Function(
    `${ProductOptions.generateProductOptionsHelperCode()}\nreturn { canonical: __poCanonical, key: __poKey };`
  )()

/** A cart line's `configuration` + `configurationKey` for these answers. */
export const configured = (answers: Array<{ key: string; value: unknown }>) => {
  const runtime = productOptionsRuntime()
  return { configuration: runtime.canonical(answers), configurationKey: runtime.key(answers) }
}
