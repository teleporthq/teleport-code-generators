import {
  generateProductOptionsHelperCode,
  PRODUCT_OPTIONS_HELPERS_CLOSING,
  PRODUCT_OPTIONS_HELPERS_OPENING,
} from '../../src/utils/product-options'

/**
 * Product options — the ES5 copy the published storefront runs (product
 * transform, cart provider, workflow scripts).
 *
 * ⚠️ The fixture table below is SHARED with teleport-gui
 * (`features/e-commerce/utils/__tests__/product-options-parity.spec.ts`), where
 * the same rows run against the TypeScript model and the GUI's copy of this
 * block. Two specs, one table: that is what proves the configurator, the cart,
 * the checkout and the order price the same configuration the same way. Edit
 * both tables or neither.
 */

type ProductOptionsApi = Record<string, (...args: unknown[]) => unknown>

const loadApi = (): ProductOptionsApi =>
  new Function(
    '"use strict";\n' +
      generateProductOptionsHelperCode() +
      '\nreturn { parseGroups: __poParseGroups, serialize: __poSerialize, validate: __poValidate,' +
      ' parseEntries: __poParseEntries, canonical: __poCanonical, canonicalForKey: __poCanonicalForKey,' +
      ' key: __poKey, defaultSelection: __poDefaultSelection, defaultEntries: __poDefaultEntries,' +
      ' entriesFromSelection: __poEntriesFromSelection, effectiveRule: __poEffectiveRule,' +
      ' effectiveVariant: __poEffectiveVariant, priceVariantKey: __poPriceVariantKey,' +
      ' resolve: __poResolve, resolveForRow: __poResolveForRow, label: __poLabel, details: __poDetails,' +
      ' priceLabel: __poPriceLabel,' +
      ' localize: function (main, clone) { return __poLocalize({ main: main, clone: clone }); },' +
      ' requiresInput: __poRequiresInput, quickAdd: __poQuickAdd, parseSnapshot: __poParseSnapshot,' +
      ' isFileRef: __poIsFileRef, isImage: __poIsImage, mintKey: __poMintKey, round2: __poRound2 };'
  )() as ProductOptionsApi

// ── SHARED PARITY TABLE ─────────────────────────────────────────────────────
// Byte-identical in teleport-gui `product-options-parity.spec.ts` and
// teleport-code-generators `teleport-shared/__tests__/utils/product-options.ts`.
// Each row calls one `__po*` entry point (and, in the GUI, its TypeScript twin)
// with `args` and states the expected result: `resolve` / `resolveForRow` rows
// state only the fields they are about, every other row the whole result.
// Groups are stored `option_groups` shapes; configurations are what a cart
// line carries. Edit both tables or neither.
type ProductOptionsCall =
  | 'parseGroups'
  | 'serialize'
  | 'validate'
  | 'parseEntries'
  | 'canonical'
  | 'canonicalForKey'
  | 'key'
  | 'defaultSelection'
  | 'defaultEntries'
  | 'entriesFromSelection'
  | 'effectiveRule'
  | 'effectiveVariant'
  | 'priceVariantKey'
  | 'resolve'
  | 'resolveForRow'
  | 'label'
  | 'details'
  | 'priceLabel'
  | 'localize'
  | 'requiresInput'
  | 'quickAdd'
  | 'parseSnapshot'
  | 'isFileRef'
  | 'isImage'
  | 'mintKey'
  | 'round2'

interface ProductOptionsFixture {
  name: string
  call: ProductOptionsCall
  args: unknown[]
  expected: unknown
}

const NONE = { mode: 'none' }

const GLOSSY = {
  key: 'glossy',
  label: 'Glossy',
  price: { mode: 'fixed', amount: 2 },
  priceWhen: [
    { groupKey: 'size', valueKeys: ['a5'], price: { mode: 'fixed', amount: 3 } },
    { groupKey: 'size', valueKeys: ['a4'], price: { mode: 'fixed', amount: 5 } },
    { groupKey: 'size', valueKeys: ['a3'], price: { mode: 'fixed', amount: 8 } },
  ],
}

// The worked example: a $10 print, Size A5 +0 / A4 +4 / A3 +9 (A2 +15 has no
// paper override), Glossy priced by Size (A5 +3, A4 +5, A3 +8, otherwise +2),
// Fine-art +40% of the charged base, and the shopper's photo.
const PRINT_GROUPS = [
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
      { key: 'a2', label: 'A2', price: { mode: 'fixed', amount: 15 } },
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
      GLOSSY,
      { key: 'fine-art', label: 'Fine-art', price: { mode: 'percent', percent: 40 } },
    ],
  },
  {
    key: 'your-photo',
    label: 'Your photo',
    type: 'upload',
    required: true,
    price: NONE,
    accept: 'image',
    maxFiles: 1,
  },
]

// A storage-worker file reference: the id carries a digit, an underscore, a
// dash and a dot, which a `\w`-style class would lose in a quoted-array copy.
const PHOTO = {
  id: 'a1_b2-c3.d4',
  name: 'IMG_2231.jpg',
  size: 204800,
  url: 'https://files.example.com/uploads/a1_b2-c3.d4.jpg',
  mimeType: 'image/jpeg',
}

const PHOTO_RENAMED = {
  id: 'a1_b2-c3.d4',
  name: 'holiday.jpg',
  size: 204800,
  url: 'https://cdn.example.com/moved/a1_b2-c3.d4.jpg',
  mimeType: 'image/jpeg',
}

const PRINT_A3_GLOSSY = [
  { key: 'size', value: 'a3' },
  { key: 'paper', value: 'glossy' },
  { key: 'your-photo', value: [PHOTO] },
]

const MACHINE_GROUPS = [
  {
    key: 'material',
    label: 'Material',
    type: 'choice',
    required: true,
    values: [
      { key: 'steel', label: 'Steel', price: NONE },
      { key: 'aluminium', label: 'Aluminium', price: NONE },
    ],
  },
  {
    key: 'extras',
    label: 'Extras',
    type: 'multi-choice',
    required: false,
    values: [
      { key: 'handle', label: 'Handle', price: { mode: 'fixed', amount: 2 } },
      { key: 'wheels', label: 'Wheels', price: { mode: 'fixed', amount: 3.5 } },
      { key: 'lid', label: 'Lid', price: NONE },
    ],
  },
  {
    key: 'finish',
    label: 'Finish',
    type: 'choice',
    required: false,
    values: [
      {
        key: 'lacquer',
        label: 'Lacquer',
        price: { mode: 'fixed', amount: 1 },
        priceWhen: [
          { groupKey: 'extras', valueKeys: ['wheels', 'lid'], price: { mode: 'fixed', amount: 3 } },
        ],
      },
    ],
  },
  {
    key: 'length',
    label: 'Length',
    type: 'number',
    required: true,
    min: 1,
    max: 50,
    step: 0.5,
    unit: 'm',
    price: { mode: 'per-unit', amount: 4 },
    priceWhen: [
      { groupKey: 'material', valueKeys: ['steel'], price: { mode: 'per-unit', amount: 5 } },
      { groupKey: 'material', valueKeys: ['aluminium'], price: { mode: 'per-unit', amount: 3 } },
    ],
  },
]

const ENGRAVING_GROUPS = [
  {
    key: 'engrave',
    label: 'Add engraving',
    type: 'toggle',
    required: false,
    price: { mode: 'fixed', amount: 4 },
  },
  {
    key: 'engraving-text',
    label: 'Engraving',
    type: 'text',
    required: true,
    maxLength: 30,
    price: NONE,
    priceWhen: [{ groupKey: 'engrave', valueKeys: ['on'], price: { mode: 'fixed', amount: 2.5 } }],
    visibleWhen: [{ groupKey: 'engrave', operator: 'is', valueKeys: ['on'] }],
  },
]

const DEFAULTS_GROUPS = [
  {
    key: 'colour',
    label: 'Colour',
    type: 'choice',
    required: true,
    display: 'swatches',
    values: [
      { key: 'black', label: 'Black', color: '#111111', price: NONE },
      { key: 'red', label: 'Red', color: '#ef4444', price: NONE, default: true },
    ],
  },
  {
    key: 'extras',
    label: 'Extras',
    type: 'multi-choice',
    required: false,
    values: [
      { key: 'strap', label: 'Strap', price: NONE, default: true },
      { key: 'case', label: 'Case', price: NONE },
      { key: 'charger', label: 'Charger', price: NONE, default: true },
    ],
  },
  {
    key: 'quantity',
    label: 'Names',
    type: 'number',
    required: true,
    min: 1,
    max: 5,
    defaultValue: 2,
    price: NONE,
  },
  { key: 'wrap', label: 'Gift wrap', type: 'toggle', required: false, price: NONE },
]

const SURCHARGED_DEFAULT_GROUPS = [
  {
    key: 'size',
    label: 'Size',
    type: 'choice',
    required: true,
    values: [
      { key: 's', label: 'S', price: NONE },
      { key: 'l', label: 'L', price: { mode: 'fixed', amount: 6 }, default: true },
    ],
  },
]

const LONG_TEXT_GROUPS = ['a', 'b', 'c', 'd', 'e'].map((key) => ({
  key: 'note-' + key,
  label: 'Note ' + key,
  type: 'long-text',
  required: false,
  price: NONE,
}))

const PRODUCT_OPTIONS_FIXTURES: ProductOptionsFixture[] = [
  // ── resolve: money ──
  {
    name: 'no groups and no configuration charge nothing and have no key',
    call: 'resolve',
    args: [10, [], '', false],
    expected: {
      delta: 0,
      valid: true,
      canonical: '',
      key: '',
      label: '',
      details: '',
      entries: [],
      errors: [],
    },
  },
  {
    name: 'a fixed surcharge is added to the base',
    call: 'resolve',
    args: [
      100,
      [
        {
          key: 'engraving',
          label: 'Engraving',
          type: 'text',
          required: false,
          maxLength: 30,
          price: { mode: 'fixed', amount: 5 },
        },
      ],
      [{ key: 'engraving', value: '  For Ana  ' }],
      false,
    ],
    expected: {
      delta: 5,
      valid: true,
      canonical: '[{"key":"engraving","value":"For Ana"}]',
      label: 'Engraving: For Ana',
    },
  },
  {
    name: 'a percent option is a share of the discounted base',
    call: 'resolve',
    args: [
      80,
      [
        {
          key: 'finish',
          label: 'Finish',
          type: 'choice',
          required: true,
          values: [{ key: 'gold', label: 'Gold', price: { mode: 'percent', percent: 10 } }],
        },
      ],
      [{ key: 'finish', value: 'gold' }],
      false,
    ],
    expected: { delta: 8, valid: true },
  },
  {
    name: '15% of 19.99 rounds to 3.00',
    call: 'resolve',
    args: [
      19.99,
      [
        {
          key: 'finish',
          label: 'Finish',
          type: 'choice',
          required: true,
          values: [{ key: 'gold', label: 'Gold', price: { mode: 'percent', percent: 15 } }],
        },
      ],
      [{ key: 'finish', value: 'gold' }],
      false,
    ],
    expected: { delta: 3, valid: true },
  },
  {
    name: 'two 33.3% entries round each, then sum (6.66, not 6.67)',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'wrap',
          label: 'Wrap',
          type: 'toggle',
          required: false,
          price: { mode: 'percent', percent: 33.3 },
        },
        {
          key: 'card',
          label: 'Card',
          type: 'toggle',
          required: false,
          price: { mode: 'percent', percent: 33.3 },
        },
      ],
      [
        { key: 'wrap', value: true },
        { key: 'card', value: true },
      ],
      false,
    ],
    expected: {
      delta: 6.66,
      valid: true,
      label: 'Wrap: Yes · Card: Yes',
      entries: [
        {
          key: 'wrap',
          label: 'Wrap',
          type: 'toggle',
          value: true,
          valueLabel: 'Yes',
          priceDelta: 3.33,
        },
        {
          key: 'card',
          label: 'Card',
          type: 'toggle',
          value: true,
          valueLabel: 'Yes',
          priceDelta: 3.33,
        },
      ],
    },
  },
  {
    name: 'per-unit 0.35 × 12 is 4.20',
    call: 'resolve',
    args: [
      20,
      [
        {
          key: 'length',
          label: 'Length',
          type: 'number',
          required: true,
          min: 1,
          max: 100,
          unit: 'm',
          price: { mode: 'per-unit', amount: 0.35 },
        },
      ],
      [{ key: 'length', value: '12' }],
      false,
    ],
    expected: { delta: 4.2, canonical: '[{"key":"length","value":12}]', label: 'Length: 12 m' },
  },
  {
    name: 'a multi-choice sums its values',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'material', value: 'steel' },
        { key: 'extras', value: ['wheels', 'handle'] },
        { key: 'length', value: 1 },
      ],
      false,
    ],
    expected: { delta: 10.5, label: 'Material: Steel · Extras: Handle, Wheels · Length: 1 m' },
  },
  {
    name: 'a toggle switched on is charged',
    call: 'resolve',
    args: [
      30,
      ENGRAVING_GROUPS,
      [
        { key: 'engrave', value: true },
        { key: 'engraving-text', value: 'To M' },
      ],
      false,
    ],
    expected: {
      delta: 6.5,
      valid: true,
      canonical: '[{"key":"engrave","value":true},{"key":"engraving-text","value":"To M"}]',
    },
  },
  {
    name: 'a toggle switched off is absent, and hides what depends on it',
    call: 'resolve',
    args: [
      30,
      ENGRAVING_GROUPS,
      [
        { key: 'engrave', value: false },
        { key: 'engraving-text', value: 'To M' },
      ],
      false,
    ],
    expected: { delta: 0, valid: true, canonical: '', key: '', visibleKeys: ['engrave'] },
  },
  {
    name: 'whitespace-only text is no answer: a required text is missing',
    call: 'resolve',
    args: [
      30,
      ENGRAVING_GROUPS,
      [
        { key: 'engrave', value: 'on' },
        { key: 'engraving-text', value: '   ' },
      ],
      false,
    ],
    expected: {
      valid: false,
      missingKeys: ['engraving-text'],
      missingLabels: ['Engraving'],
      canonical: '[{"key":"engrave","value":true}]',
    },
  },
  {
    name: 'whitespace-only text on an optional text leaves nothing in the configuration',
    call: 'resolve',
    args: [
      5,
      [{ key: 'note', label: 'Note', type: 'text', required: false, price: NONE }],
      [{ key: 'note', value: ' \n ' }],
      false,
    ],
    expected: { valid: true, canonical: '', key: '', entries: [] },
  },
  // ── resolve: price by an earlier choice ──
  {
    name: 'worked example: A3 + Glossy on a $10 print is $27',
    call: 'resolve',
    args: [10, PRINT_GROUPS, PRINT_A3_GLOSSY, false],
    expected: {
      delta: 17,
      valid: true,
      canonical:
        '[{"key":"paper","value":"glossy"},{"key":"size","value":"a3"},{"key":"your-photo","value":[{"id":"a1_b2-c3.d4","name":"IMG_2231.jpg","size":204800,"url":"https://files.example.com/uploads/a1_b2-c3.d4.jpg","mimeType":"image/jpeg"}]}]',
      key: 'e1dca133dbeaeda7',
      label: 'Size: A3 · Paper: Glossy · Your photo: IMG_2231.jpg',
      details: 'Size: A3\nPaper: Glossy\nYour photo: IMG_2231.jpg',
      entries: [
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          value: 'a3',
          valueLabel: 'A3',
          priceDelta: 9,
        },
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          value: 'glossy',
          valueLabel: 'Glossy',
          priceDelta: 8,
        },
        {
          key: 'your-photo',
          label: 'Your photo',
          type: 'upload',
          value: ['a1_b2-c3.d4'],
          valueLabel: 'IMG_2231.jpg',
          priceDelta: 0,
          files: [
            {
              id: 'a1_b2-c3.d4',
              name: 'IMG_2231.jpg',
              size: 204800,
              url: 'https://files.example.com/uploads/a1_b2-c3.d4.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
      ],
      errors: [],
      missingKeys: [],
      missingLabels: [],
      visibleKeys: ['size', 'paper', 'your-photo'],
    },
  },
  {
    name: 'a renamed upload keeps the line key (the key hashes the file id only)',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'your-photo', value: [PHOTO_RENAMED] },
        { key: 'paper', value: 'glossy' },
        { key: 'size', value: 'a3' },
      ],
      false,
    ],
    expected: {
      delta: 17,
      key: 'e1dca133dbeaeda7',
      label: 'Size: A3 · Paper: Glossy · Your photo: holiday.jpg',
    },
  },
  {
    name: 'no override for the chosen size falls back to the default price',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a2' },
        { key: 'paper', value: 'glossy' },
        { key: 'your-photo', value: [PHOTO] },
      ],
      false,
    ],
    expected: { delta: 17, label: 'Size: A2 · Paper: Glossy · Your photo: IMG_2231.jpg' },
  },
  {
    name: 'a percent value is a share of the base, not of the running total',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a3' },
        { key: 'paper', value: 'fine-art' },
        { key: 'your-photo', value: [PHOTO] },
      ],
      false,
    ],
    expected: { delta: 13, label: 'Size: A3 · Paper: Fine-art · Your photo: IMG_2231.jpg' },
  },
  {
    name: 'a percent override is a share of the variant base',
    call: 'resolve',
    args: [
      24.5,
      [
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: true,
          values: [
            { key: 'a4', label: 'A4', price: NONE },
            { key: 'a3', label: 'A3', price: NONE },
          ],
        },
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          required: true,
          values: [
            {
              key: 'glossy',
              label: 'Glossy',
              price: { mode: 'percent', percent: 10 },
              priceWhen: [
                { groupKey: 'size', valueKeys: ['a3'], price: { mode: 'percent', percent: 20 } },
              ],
            },
          ],
        },
      ],
      [
        { key: 'size', value: 'a3' },
        { key: 'paper', value: 'glossy' },
      ],
      false,
    ],
    expected: { delta: 4.9, valid: true },
  },
  {
    name: 'a hidden price source leaves the default price',
    call: 'resolve',
    args: [
      10,
      [
        { key: 'custom', label: 'Custom size', type: 'toggle', required: false, price: NONE },
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: true,
          values: [
            { key: 's', label: 'S', price: NONE },
            { key: 'l', label: 'L', price: NONE },
          ],
          visibleWhen: [{ groupKey: 'custom', operator: 'is-set' }],
        },
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          required: true,
          values: [
            {
              key: 'glossy',
              label: 'Glossy',
              price: { mode: 'fixed', amount: 2 },
              priceWhen: [
                { groupKey: 'size', valueKeys: ['l'], price: { mode: 'fixed', amount: 6 } },
              ],
            },
          ],
        },
      ],
      [
        { key: 'size', value: 'l' },
        { key: 'paper', value: 'glossy' },
      ],
      false,
    ],
    expected: {
      delta: 2,
      valid: true,
      canonical: '[{"key":"paper","value":"glossy"}]',
      visibleKeys: ['custom', 'paper'],
    },
  },
  {
    name: 'a multi-choice source matches when the picks intersect the override',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'material', value: 'steel' },
        { key: 'extras', value: ['handle', 'lid'] },
        { key: 'finish', value: 'lacquer' },
        { key: 'length', value: 1 },
      ],
      false,
    ],
    expected: {
      delta: 10,
      label: 'Material: Steel · Extras: Handle, Lid · Finish: Lacquer · Length: 1 m',
    },
  },
  {
    name: 'a toggle source matches its on value',
    call: 'resolve',
    args: [
      30,
      ENGRAVING_GROUPS,
      [
        { key: 'engrave', value: 'true' },
        { key: 'engraving-text', value: 'Ana & Tom' },
      ],
      false,
    ],
    expected: { delta: 6.5, label: 'Add engraving: Yes · Engraving: Ana & Tom' },
  },
  {
    name: 'a per-unit override on a number group follows the material',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'material', value: 'aluminium' },
        { key: 'length', value: 12 },
      ],
      false,
    ],
    expected: { delta: 36, label: 'Material: Aluminium · Length: 12 m' },
  },
  {
    name: 'the first matching override wins',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: true,
          values: [
            { key: 'a4', label: 'A4', price: NONE },
            { key: 'a3', label: 'A3', price: NONE },
          ],
        },
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          required: true,
          values: [
            {
              key: 'glossy',
              label: 'Glossy',
              price: NONE,
              priceWhen: [
                { groupKey: 'size', valueKeys: ['a3'], price: { mode: 'fixed', amount: 8 } },
                { groupKey: 'size', valueKeys: ['a3', 'a4'], price: { mode: 'fixed', amount: 20 } },
              ],
            },
          ],
        },
      ],
      [
        { key: 'size', value: 'a3' },
        { key: 'paper', value: 'glossy' },
      ],
      false,
    ],
    expected: { delta: 8 },
  },
  // ── resolve: what makes a configuration invalid ──
  {
    name: 'required options left empty are missing',
    call: 'resolve',
    args: [10, PRINT_GROUPS, [{ key: 'size', value: 'a4' }], false],
    expected: {
      delta: 4,
      valid: false,
      errors: [],
      missingKeys: ['paper', 'your-photo'],
      missingLabels: ['Paper', 'Your photo'],
    },
  },
  {
    name: 'a value removed from the product is invalid and charges nothing',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a0' },
        { key: 'paper', value: 'matte' },
        { key: 'your-photo', value: [PHOTO] },
      ],
      false,
    ],
    expected: { delta: 0, valid: false, errors: ['unknown-value:size'], missingKeys: ['size'] },
  },
  {
    name: 'a number outside its range is invalid',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'material', value: 'steel' },
        { key: 'length', value: 80 },
      ],
      false,
    ],
    expected: { valid: false, errors: ['out-of-range:length'] },
  },
  {
    name: 'an unsafe file is refused',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a5' },
        { key: 'paper', value: 'matte' },
        {
          key: 'your-photo',
          value: [
            {
              id: 'x1',
              name: 'x.jpg',
              size: 10,
              url: 'javascript:alert(1)',
              mimeType: 'image/jpeg',
            },
          ],
        },
      ],
      false,
    ],
    expected: {
      valid: false,
      errors: ['bad-file:your-photo'],
      missingKeys: ['your-photo'],
      canonical: '[{"key":"paper","value":"matte"},{"key":"size","value":"a5"}]',
    },
  },
  {
    name: 'a canonical string over 8000 characters is too long',
    call: 'resolve',
    args: [
      5,
      LONG_TEXT_GROUPS,
      LONG_TEXT_GROUPS.map((group) => ({ key: group.key, value: 'x'.repeat(1700) })),
      false,
    ],
    expected: { delta: 0, valid: false, errors: ['too-long'] },
  },
  {
    name: 'the same answers in another order give the same canonical string and key',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'length', value: 1 },
        { key: 'extras', value: ['wheels', 'handle'] },
        { key: 'material', value: 'steel' },
      ],
      false,
    ],
    expected: {
      canonical:
        '[{"key":"extras","value":["handle","wheels"]},{"key":"length","value":1},{"key":"material","value":"steel"}]',
      key: 'b5d22cedfbe5c44b',
    },
  },
  {
    name: 'pricesDisabled charges nothing whatever is stored',
    call: 'resolve',
    args: [10, PRINT_GROUPS, PRINT_A3_GLOSSY, true],
    expected: { delta: 0, valid: true, key: 'e1dca133dbeaeda7' },
  },
  // ── resolveForRow: the product row decides ──
  {
    name: 'a gift-card row charges nothing, overrides included',
    call: 'resolveForRow',
    args: [
      { option_groups: JSON.stringify(PRINT_GROUPS), is_gift_card: 't', payment_type: 'one_time' },
      10,
      PRINT_A3_GLOSSY,
    ],
    expected: {
      delta: 0,
      valid: true,
      label: 'Size: A3 · Paper: Glossy · Your photo: IMG_2231.jpg',
    },
  },
  {
    name: 'a recurring row charges nothing',
    call: 'resolveForRow',
    args: [
      { option_groups: PRINT_GROUPS, is_gift_card: false, payment_type: 'recurring' },
      10,
      PRINT_A3_GLOSSY,
    ],
    expected: { delta: 0, valid: true },
  },
  {
    name: 'a negative stored amount charges nothing',
    call: 'resolveForRow',
    args: [
      {
        option_groups: JSON.stringify([
          {
            key: 'wrap',
            label: 'Wrap',
            type: 'toggle',
            required: false,
            price: { mode: 'fixed', amount: -5 },
          },
        ]),
      },
      10,
      JSON.stringify([{ key: 'wrap', value: true }]),
    ],
    expected: { delta: 0, valid: true, canonical: '[{"key":"wrap","value":true}]' },
  },
  {
    name: 'malformed option_groups: no groups, so any configuration is invalid',
    call: 'resolveForRow',
    args: [{ option_groups: '{not json' }, 10, [{ key: 'size', value: 'a3' }]],
    expected: { delta: 0, valid: false, errors: ['unknown-option:size'], canonical: '' },
  },
  {
    name: 'a plain product row stays plain',
    call: 'resolveForRow',
    args: [{ option_groups: null }, 10, ''],
    expected: { delta: 0, valid: true, canonical: '', key: '', label: '', details: '' },
  },
  // ── defaults, requiresInput, quickAdd ──
  {
    name: 'default selection',
    call: 'defaultSelection',
    args: [DEFAULTS_GROUPS],
    expected: { colour: 'red', extras: ['strap', 'charger'], quantity: 2 },
  },
  {
    name: 'default entries',
    call: 'defaultEntries',
    args: [DEFAULTS_GROUPS],
    expected: [
      { key: 'colour', value: 'red' },
      { key: 'extras', value: ['strap', 'charger'] },
      { key: 'quantity', value: 2 },
    ],
  },
  {
    name: 'entries from a selection skip empty answers',
    call: 'entriesFromSelection',
    args: [{ size: 'a3', extras: ['lid'], note: null, wrap: false }],
    expected: [
      { key: 'size', value: 'a3' },
      { key: 'extras', value: ['lid'] },
      { key: 'wrap', value: false },
    ],
  },
  {
    name: 'required options without defaults require input',
    call: 'requiresInput',
    args: [PRINT_GROUPS],
    expected: true,
  },
  {
    name: 'valid defaults need no input',
    call: 'requiresInput',
    args: [DEFAULTS_GROUPS],
    expected: false,
  },
  { name: 'no options need no input', call: 'requiresInput', args: [[]], expected: false },
  {
    name: 'valid defaults that cost nothing allow a quick add',
    call: 'quickAdd',
    args: [DEFAULTS_GROUPS, 20, false],
    expected: true,
  },
  {
    name: 'a surcharged default refuses a quick add',
    call: 'quickAdd',
    args: [SURCHARGED_DEFAULT_GROUPS, 20, false],
    expected: false,
  },
  {
    name: 'a surcharged default on a gift card allows a quick add',
    call: 'quickAdd',
    args: [SURCHARGED_DEFAULT_GROUPS, 20, true],
    expected: true,
  },
  {
    name: 'required input refuses a quick add',
    call: 'quickAdd',
    args: [PRINT_GROUPS, 10, false],
    expected: false,
  },
  // ── effective rule ──
  {
    name: 'effective rule: a shown, matching source picks the override',
    call: 'effectiveRule',
    args: [GLOSSY, { size: 'a4' }, ['size']],
    expected: { mode: 'fixed', amount: 5 },
  },
  {
    name: 'effective rule: a hidden source leaves the default',
    call: 'effectiveRule',
    args: [GLOSSY, { size: 'a4' }, []],
    expected: { mode: 'fixed', amount: 2 },
  },
  {
    name: 'effective rule: a toggle source answers on',
    call: 'effectiveRule',
    args: [ENGRAVING_GROUPS[1], { engrave: true }, ['engrave']],
    expected: { mode: 'fixed', amount: 2.5 },
  },
  {
    name: 'effective rule: nothing priced is none',
    call: 'effectiveRule',
    args: [{}, {}, []],
    expected: { mode: 'none' },
  },
  // ── parse / serialize / validate ──
  {
    name: 'parse drops rules that point at later or unknown groups and repairs the rest',
    call: 'parseGroups',
    args: [
      JSON.stringify([
        {
          key: 'Paper',
          label: '  Paper  ',
          type: 'dropdown',
          display: 'carousel',
          values: [
            {
              label: 'Glossy',
              price: { mode: 'per-unit', amount: 3 },
              default: 'true',
              priceWhen: [{ groupKey: 'size', valueKeys: ['a3'], price: 5 }],
            },
            {
              key: 'glossy',
              label: 'Glossy again',
              price: { mode: 'fixed', amount: -2 },
              default: true,
            },
            'junk',
          ],
        },
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: 't',
          values: [{ key: 'a3', label: 'A3', price: { mode: 'percent', percent: 5000 } }],
          visibleWhen: [
            { groupKey: 'paper', operator: 'is', valueKeys: ['glossy', 'missing'] },
            { groupKey: 'paper', operator: 'near' },
            { groupKey: 'later', operator: 'is-set' },
          ],
        },
        { key: 'size', label: 'Size', type: 'toggle', required: true, price: { mode: 'bogus' } },
        { label: 'Photo', type: 'upload', accept: 'svg' },
        { label: 'Words', type: 'text', maxLength: 99999 },
      ]),
    ],
    expected: [
      {
        key: 'paper',
        label: 'Paper',
        type: 'choice',
        required: false,
        display: 'buttons',
        values: [
          { key: 'glossy', label: 'Glossy', price: { mode: 'fixed', amount: 3 }, default: true },
          { key: 'glossy-2', label: 'Glossy again', price: { mode: 'fixed', amount: 0 } },
        ],
      },
      {
        key: 'size',
        label: 'Size',
        type: 'choice',
        required: true,
        display: 'buttons',
        values: [{ key: 'a3', label: 'A3', price: { mode: 'percent', percent: 1000 } }],
        visibleWhen: [{ groupKey: 'paper', operator: 'is', valueKeys: ['glossy'] }],
      },
      { key: 'size-2', label: 'Size', type: 'toggle', required: false, price: { mode: 'none' } },
      {
        key: 'photo',
        label: 'Photo',
        type: 'upload',
        required: false,
        price: { mode: 'none' },
        accept: 'any',
        maxFiles: 1,
      },
      {
        key: 'words',
        label: 'Words',
        type: 'text',
        required: false,
        maxLength: 500,
        price: { mode: 'none' },
      },
    ],
  },
  {
    name: 'parse: malformed JSON is no groups',
    call: 'parseGroups',
    args: ['{nope'],
    expected: [],
  },
  {
    name: 'parse: not an array is no groups',
    call: 'parseGroups',
    args: [{ key: 'x' }],
    expected: [],
  },
  {
    name: 'serialize writes one key order and drops unknown fields',
    call: 'serialize',
    args: [
      [
        {
          visibleWhen: undefined,
          price: { amount: 3, mode: 'fixed' },
          type: 'toggle',
          label: 'Wrap',
          key: 'wrap',
          required: 1,
          extra: 'x',
        },
      ],
    ],
    expected:
      '[{"key":"wrap","label":"Wrap","type":"toggle","required":false,"price":{"mode":"fixed","amount":3}}]',
  },
  { name: 'serialize: nothing is null', call: 'serialize', args: [[]], expected: null },
  {
    name: 'validate names a price source placed after its option',
    call: 'validate',
    args: [
      [
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          required: true,
          values: [
            {
              key: 'glossy',
              label: 'Glossy',
              price: NONE,
              priceWhen: [
                { groupKey: 'size', valueKeys: ['a3'], price: { mode: 'fixed', amount: 8 } },
              ],
            },
          ],
        },
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: true,
          values: [{ key: 'a3', label: 'A3', price: NONE }],
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'PRICE_SOURCE_LATER',
        message:
          'A price on “Paper” depends on “Size”, which comes after it. Move “Size” above “Paper”.',
        groupIndex: 0,
        groupKey: 'paper',
        valueKey: 'glossy',
      },
    ],
  },
  {
    name: 'validate: structure problems',
    call: 'validate',
    args: [
      [
        { key: 'empty', label: '', type: 'choice', required: true, values: [] },
        {
          key: 'extras',
          label: 'Extras',
          type: 'multi-choice',
          required: false,
          minSelected: 3,
          maxSelected: 2,
          values: [
            { key: 'a', label: 'A', price: { mode: 'per-unit', amount: 1 } },
            { key: 'a', label: '', price: { mode: 'fixed', amount: -1 } },
          ],
        },
        {
          key: 'len',
          label: 'Length',
          type: 'number',
          required: true,
          min: 5,
          max: 1,
          step: 0,
          defaultValue: 9,
          price: { mode: 'percent', percent: 2000 },
        },
        {
          key: 'note',
          label: 'Note',
          type: 'text',
          required: false,
          maxLength: 900,
          price: NONE,
          visibleWhen: [{ groupKey: 'len', operator: 'is-set' }],
        },
        {
          key: 'note',
          label: 'Again',
          type: 'toggle',
          required: false,
          price: NONE,
          visibleWhen: [{ groupKey: 'gone', operator: 'is-set' }],
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'GROUP_LABEL_REQUIRED',
        message: 'Option 1 needs a name.',
        groupIndex: 0,
        groupKey: 'empty',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'CHOICE_NEEDS_VALUE',
        message: '“Option 1” needs at least one choice.',
        groupIndex: 0,
        groupKey: 'empty',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'PRICE_PER_UNIT_NUMBER_ONLY',
        message: 'Only a number option can be priced per unit, so “Extras” cannot.',
        groupIndex: 1,
        groupKey: 'extras',
        valueKey: 'a',
      },
      {
        severity: 'error',
        code: 'VALUE_LABEL_REQUIRED',
        message: 'Every choice of “Extras” needs a name.',
        groupIndex: 1,
        groupKey: 'extras',
        valueKey: 'a',
      },
      {
        severity: 'error',
        code: 'DUPLICATE_VALUE_KEY',
        message: 'Two choices of “Extras” use the same internal key.',
        groupIndex: 1,
        groupKey: 'extras',
        valueKey: 'a',
      },
      {
        severity: 'error',
        code: 'PRICE_AMOUNT_INVALID',
        message: 'Prices on “Extras” must be between 0 and 1,000,000,000.',
        groupIndex: 1,
        groupKey: 'extras',
        valueKey: 'a',
      },
      {
        severity: 'error',
        code: 'MULTI_MIN_MAX',
        message: '“Extras”: the minimum number of picks is more than the maximum.',
        groupIndex: 1,
        groupKey: 'extras',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'NUMBER_MIN_MAX',
        message: '“Length”: the minimum is more than the maximum.',
        groupIndex: 2,
        groupKey: 'len',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'NUMBER_STEP',
        message: '“Length”: the step must be more than 0.',
        groupIndex: 2,
        groupKey: 'len',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'NUMBER_DEFAULT_RANGE',
        message: '“Length”: the starting value must be between the minimum and the maximum.',
        groupIndex: 2,
        groupKey: 'len',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'PRICE_PERCENT_RANGE',
        message: 'A percentage on “Length” must be between 0 and 1000.',
        groupIndex: 2,
        groupKey: 'len',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'TEXT_MAX_LENGTH',
        message: '“Note”: the character limit must be between 1 and 500.',
        groupIndex: 3,
        groupKey: 'note',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'VISIBILITY_SOURCE_TYPE',
        message:
          '“Note” can only be shown depending on a pick-one, pick-several or yes-or-no option.',
        groupIndex: 3,
        groupKey: 'note',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'DUPLICATE_GROUP_KEY',
        message: '“Again” uses the same internal key as an earlier option.',
        groupIndex: 4,
        groupKey: 'note',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'VISIBILITY_SOURCE_MISSING',
        message: '“Again” is shown depending on an option that no longer exists.',
        groupIndex: 4,
        groupKey: 'note',
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: a gift card may not carry option prices',
    call: 'validate',
    args: [PRINT_GROUPS, 'true', 'one_time'],
    expected: [
      {
        severity: 'error',
        code: 'GIFT_CARD_OPTIONS_PRICE',
        message:
          'Gift cards can have options, but not prices on them. Set every option to no extra charge.',
        groupIndex: null,
        groupKey: null,
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: a subscription may not carry option prices',
    call: 'validate',
    args: [PRINT_GROUPS, false, 'recurring'],
    expected: [
      {
        severity: 'error',
        code: 'RECURRING_OPTIONS_PRICE',
        message:
          'Subscription products can have options, but not prices on them. Set every option to no extra charge.',
        groupIndex: null,
        groupKey: null,
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: long texts that could overflow the cart are a warning',
    call: 'validate',
    args: [LONG_TEXT_GROUPS, false, ''],
    expected: [
      {
        severity: 'warning',
        code: 'CONFIGURATION_TOO_LONG',
        message:
          'Filled in to their limits, these options could exceed 8000 characters and be refused at checkout. Use fewer options, or lower the character limits of the text options.',
        groupIndex: null,
        groupKey: null,
        valueKey: null,
      },
    ],
  },
  // ── configuration entries and keys ──
  {
    name: 'parse entries: string or array, first key wins, junk dropped',
    call: 'parseEntries',
    args: [
      '[{"key":"size","value":"a3"},{"key":"size","value":"a4"},{"value":"x"},{"key":"n","value":7},{"key":"f","value":{"id":"f1","name":"a.pdf","size":"12","url":"https://x.example.com/a.pdf","mimeType":"application/pdf"}},{"key":"bad","value":null}]',
    ],
    expected: [
      { key: 'size', value: 'a3' },
      { key: 'n', value: 7 },
      {
        key: 'f',
        value: [
          {
            id: 'f1',
            name: 'a.pdf',
            size: 12,
            url: 'https://x.example.com/a.pdf',
            mimeType: 'application/pdf',
          },
        ],
      },
    ],
  },
  {
    name: 'canonical: sorted keys, trimmed text, sorted picks, toggle off and blanks dropped',
    call: 'canonical',
    args: [
      [
        { key: 'z', value: ' hi ' },
        { key: 'm', value: ['b', 'a', 'b'] },
        { key: 'off', value: false },
        { key: 'blank', value: '  ' },
        { key: 'a', value: 3 },
      ],
    ],
    expected: '[{"key":"a","value":3},{"key":"m","value":["a","b"]},{"key":"z","value":"hi"}]',
  },
  {
    name: 'canonical for the key keeps only file ids',
    call: 'canonicalForKey',
    args: [
      [
        { key: 'your-photo', value: [PHOTO] },
        { key: 'size', value: 'a3' },
      ],
    ],
    expected: '[{"key":"size","value":"a3"},{"key":"your-photo","value":["a1_b2-c3.d4"]}]',
  },
  { name: 'key: nothing answered is no key', call: 'key', args: [[]], expected: '' },
  {
    name: 'key: the worked example',
    call: 'key',
    args: [PRINT_A3_GLOSSY],
    expected: 'e1dca133dbeaeda7',
  },
  // ── labels ──
  {
    name: 'label: one line, values clipped to 80',
    call: 'label',
    args: [
      [
        { label: 'Size', valueLabel: 'A3' },
        { label: 'Message', valueLabel: 'Line one\nline two ' + 'y'.repeat(100) },
        { label: '', valueLabel: 'Loose' },
      ],
    ],
    expected:
      'Size: A3 · Message: Line one line two yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy… · Loose',
  },
  {
    name: 'details: full values, one line each',
    call: 'details',
    args: [
      [
        { label: 'Size', valueLabel: 'A3' },
        { label: 'Message', valueLabel: 'Line one\nline two' },
      ],
    ],
    expected: 'Size: A3\nMessage: Line one\nline two',
  },
  {
    name: 'price label: fixed, tax added, symbol first',
    call: 'priceLabel',
    args: [{ mode: 'fixed', amount: 4 }, '$', 'before', 19, ''],
    expected: '+$4.76',
  },
  {
    name: 'price label: symbol after',
    call: 'priceLabel',
    args: [{ mode: 'fixed', amount: 8 }, 'kr', 'after', 0, ''],
    expected: '+8.00 kr',
  },
  {
    name: 'price label: a percent reads as a percent',
    call: 'priceLabel',
    args: [{ mode: 'percent', percent: 40 }, '$', 'before', 19, ''],
    expected: '+40%',
  },
  {
    name: 'price label: per unit with a unit',
    call: 'priceLabel',
    args: [{ mode: 'per-unit', amount: 5 }, '€', 'before', 0, 'm'],
    expected: '+€5.00 / m',
  },
  {
    name: 'price label: per unit without a unit',
    call: 'priceLabel',
    args: [{ mode: 'per-unit', amount: 0.5 }, '$', 'before', 0, ''],
    expected: '+$0.50 each',
  },
  {
    name: 'price label: nothing added is empty',
    call: 'priceLabel',
    args: [{ mode: 'fixed', amount: 0 }, '$', 'before', 19, ''],
    expected: '',
  },
  // ── localize ──
  {
    name: 'localize: strings from the clone by key, structure and prices from main',
    call: 'localize',
    args: [
      PRINT_GROUPS,
      JSON.stringify([
        {
          key: 'paper',
          label: 'Papier',
          type: 'choice',
          required: false,
          values: [
            {
              key: 'glossy',
              label: 'Brillant',
              price: { mode: 'fixed', amount: 99 },
              description: 'Ignored: the main value has none',
            },
            { key: 'matte', label: '', price: NONE },
          ],
        },
        {
          key: 'size',
          label: 'Format',
          type: 'text',
          required: false,
          price: { mode: 'fixed', amount: 99 },
        },
      ]),
    ],
    expected: [
      {
        key: 'size',
        label: 'Format',
        type: 'choice',
        required: true,
        display: 'buttons',
        values: [
          { key: 'a5', label: 'A5', price: { mode: 'none' } },
          { key: 'a4', label: 'A4', price: { mode: 'fixed', amount: 4 } },
          { key: 'a3', label: 'A3', price: { mode: 'fixed', amount: 9 } },
          { key: 'a2', label: 'A2', price: { mode: 'fixed', amount: 15 } },
        ],
      },
      {
        key: 'paper',
        label: 'Papier',
        type: 'choice',
        required: true,
        display: 'cards',
        values: [
          { key: 'matte', label: 'Matte', price: { mode: 'none' } },
          {
            key: 'glossy',
            label: 'Brillant',
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
        required: true,
        price: { mode: 'none' },
        accept: 'image',
        maxFiles: 1,
      },
    ],
  },
  {
    name: 'localize: a blank string in the clone shows the main text, also above translated choices',
    call: 'localize',
    args: [
      [
        {
          key: 'paper',
          label: 'Paper',
          type: 'choice',
          required: true,
          helpText: 'Pick a finish',
          values: [
            { key: 'matte', label: 'Matte', description: 'No glare', price: NONE },
            { key: 'glossy', label: 'Glossy', description: 'Shiny', price: NONE },
          ],
        },
        { key: 'note', label: 'Note', type: 'text', required: false, placeholder: 'For Ana' },
      ],
      JSON.stringify([
        {
          key: 'paper',
          label: '',
          type: 'choice',
          required: true,
          helpText: '',
          values: [
            { key: 'matte', label: '', description: 'Sans reflet', price: NONE },
            { key: 'glossy', label: 'Brillant', description: '', price: NONE },
          ],
        },
        { key: 'note', label: '', type: 'text', required: false, placeholder: '' },
      ]),
    ],
    expected: [
      {
        key: 'paper',
        label: 'Paper',
        type: 'choice',
        required: true,
        helpText: 'Pick a finish',
        display: 'buttons',
        values: [
          { key: 'matte', label: 'Matte', description: 'Sans reflet', price: { mode: 'none' } },
          { key: 'glossy', label: 'Brillant', description: 'Shiny', price: { mode: 'none' } },
        ],
      },
      {
        key: 'note',
        label: 'Note',
        type: 'text',
        required: false,
        placeholder: 'For Ana',
        price: { mode: 'none' },
      },
    ],
  },
  // ── order snapshots ──
  {
    name: 'snapshot v1: entries read back, unsafe files dropped',
    call: 'parseSnapshot',
    args: [
      JSON.stringify({
        v: 1,
        basePrice: 10,
        priceDelta: 17,
        entries: [
          {
            key: 'size',
            label: 'Size',
            type: 'choice',
            value: 'a3',
            valueLabel: 'A3',
            priceDelta: 9,
          },
          {
            key: 'your-photo',
            label: 'Your photo',
            type: 'upload',
            value: ['a1_b2-c3.d4', 'evil'],
            priceDelta: 0,
            files: [
              PHOTO,
              { id: 'evil', name: 'x', size: 1, url: 'javascript:alert(1)', mimeType: 'image/png' },
            ],
          },
          { label: 'No key' },
        ],
      }),
    ],
    expected: {
      version: 1,
      basePrice: 10,
      priceDelta: 17,
      entries: [
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          value: 'a3',
          valueLabel: 'A3',
          priceDelta: 9,
          files: [],
        },
        {
          key: 'your-photo',
          label: 'Your photo',
          type: 'upload',
          value: ['a1_b2-c3.d4', 'evil'],
          valueLabel: 'IMG_2231.jpg',
          priceDelta: 0,
          files: [
            {
              id: 'a1_b2-c3.d4',
              name: 'IMG_2231.jpg',
              size: 204800,
              url: 'https://files.example.com/uploads/a1_b2-c3.d4.jpg',
              mimeType: 'image/jpeg',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'snapshot legacy: the compact canonical string',
    call: 'parseSnapshot',
    args: [
      '[{"key":"engraving","value":"For Ana"},{"key":"extras","value":["handle","lid"]},{"key":"wrap","value":true},{"key":"your-photo","value":[{"id":"f1","name":"p.png","size":5,"url":"http://insecure.example.com/p.png","mimeType":"image/png"}]}]',
    ],
    expected: {
      version: 0,
      basePrice: null,
      priceDelta: null,
      entries: [
        {
          key: 'engraving',
          label: 'engraving',
          type: '',
          value: 'For Ana',
          valueLabel: 'For Ana',
          priceDelta: null,
          files: [],
        },
        {
          key: 'extras',
          label: 'extras',
          type: '',
          value: ['handle', 'lid'],
          valueLabel: 'handle, lid',
          priceDelta: null,
          files: [],
        },
        {
          key: 'wrap',
          label: 'wrap',
          type: '',
          value: true,
          valueLabel: 'Yes',
          priceDelta: null,
          files: [],
        },
        {
          key: 'your-photo',
          label: 'your-photo',
          type: '',
          value: [],
          valueLabel: '',
          priceDelta: null,
          files: [],
        },
      ],
    },
  },
  { name: 'snapshot: nothing is null', call: 'parseSnapshot', args: [''], expected: null },
  { name: 'snapshot: not JSON is null', call: 'parseSnapshot', args: ['Size: A3'], expected: null },
  // ── uploaded files ──
  {
    name: 'file ref: a storage-worker https file is safe',
    call: 'isFileRef',
    args: [PHOTO],
    expected: true,
  },
  {
    name: 'file ref: http is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, url: 'http://files.example.com/a.jpg' }],
    expected: false,
  },
  {
    name: 'file ref: javascript: is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, url: 'javascript:alert(document.cookie)' }],
    expected: false,
  },
  {
    name: 'file ref: a data URL is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, url: 'data:image/png;base64,AAAA' }],
    expected: false,
  },
  {
    name: 'file ref: an id with a space is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, id: 'a b' }],
    expected: false,
  },
  {
    name: 'file ref: a negative size is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, size: -1 }],
    expected: false,
  },
  // ── keys and rounding ──
  {
    name: 'mint key: slug of the label',
    call: 'mintKey',
    args: ['Paper Type', [], 'option'],
    expected: 'paper-type',
  },
  {
    name: 'mint key: taken keys get a suffix',
    call: 'mintKey',
    args: ['Size', ['size', 'size-2'], 'option'],
    expected: 'size-3',
  },
  {
    name: 'mint key: no slug falls back',
    call: 'mintKey',
    args: ['★', ['value'], 'value'],
    expected: 'value-2',
  },
  {
    name: 'round2 snaps a float tail to the cent',
    call: 'round2',
    args: [4.199999999999999],
    expected: 4.2,
  },
  // ── limits: what can never be charged, answered or stored ──
  {
    name: 'pricesDisabled given as {pricesDisabled: true} charges nothing too',
    call: 'resolve',
    args: [
      10,
      ENGRAVING_GROUPS,
      [
        { key: 'engrave', value: true },
        { key: 'engraving-text', value: 'Ana' },
      ],
      { pricesDisabled: true },
    ],
    expected: { delta: 0, valid: true },
  },
  {
    name: 'quick add: pricesDisabled given as {pricesDisabled: true}',
    call: 'quickAdd',
    args: [SURCHARGED_DEFAULT_GROUPS, 20, { pricesDisabled: true }],
    expected: true,
  },
  {
    name: 'validate: the product may be given as {isGiftCard, paymentType}',
    call: 'validate',
    args: [SURCHARGED_DEFAULT_GROUPS, { isGiftCard: false, paymentType: 'recurring' }, undefined],
    expected: [
      {
        severity: 'error',
        code: 'RECURRING_OPTIONS_PRICE',
        message:
          'Subscription products can have options, but not prices on them. Set every option to no extra charge.',
        groupIndex: null,
        groupKey: null,
        valueKey: null,
      },
    ],
  },
  {
    name: 'price label: the options may be given as one object',
    call: 'priceLabel',
    args: [
      { mode: 'per-unit', amount: 5 },
      { symbol: '€', position: 'after', taxRate: 20, unit: 'm' },
    ],
    expected: '+6.00 € / m',
  },
  {
    name: 'an upload of a type the option does not accept is refused (never SVG)',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a5' },
        { key: 'paper', value: 'matte' },
        { key: 'your-photo', value: [{ ...PHOTO, mimeType: 'image/svg+xml' }] },
      ],
      false,
    ],
    expected: { valid: false, errors: ['bad-file:your-photo'], missingKeys: ['your-photo'] },
  },
  {
    name: 'an upload over 4 MB is refused, and a PDF on a photo option too',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a5' },
        { key: 'paper', value: 'matte' },
        {
          key: 'your-photo',
          value: [
            { ...PHOTO, size: 4194305 },
            { ...PHOTO, id: 'b2', mimeType: 'application/pdf' },
          ],
        },
      ],
      false,
    ],
    expected: { valid: false, errors: ['bad-file:your-photo'], missingKeys: ['your-photo'] },
  },
  {
    name: 'an upload of exactly 4 MB with an upper-case MIME type is accepted',
    call: 'resolve',
    args: [
      10,
      PRINT_GROUPS,
      [
        { key: 'size', value: 'a5' },
        { key: 'paper', value: 'matte' },
        { key: 'your-photo', value: [{ ...PHOTO, size: 4194304, mimeType: 'IMAGE/JPEG' }] },
      ],
      false,
    ],
    expected: { delta: 0, valid: true, errors: [] },
  },
  {
    name: 'a huge per-unit quantity is out of range, never an infinite price',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'length',
          label: 'Length',
          type: 'number',
          required: true,
          min: 1,
          unit: 'm',
          price: { mode: 'per-unit', amount: 0.35 },
        },
      ],
      [{ key: 'length', value: '1e308' }],
      false,
    ],
    expected: { delta: 0, valid: false, errors: ['out-of-range:length'] },
  },
  {
    name: 'an amount too large to price is out of range',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'x',
          label: 'X',
          type: 'choice',
          required: true,
          values: [{ key: 'v', label: 'V', price: { mode: 'fixed', amount: 1e307 } }],
        },
      ],
      [{ key: 'x', value: 'v' }],
      false,
    ],
    expected: { delta: 0, valid: false, errors: ['out-of-range:x'] },
  },
  {
    name: 'a negative quantity priced per unit is out of range',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'length',
          label: 'Length',
          type: 'number',
          required: true,
          price: { mode: 'per-unit', amount: 5 },
        },
      ],
      [{ key: 'length', value: -3 }],
      false,
    ],
    expected: { delta: 0, valid: false, errors: ['out-of-range:length'] },
  },
  {
    name: 'a number between two steps is invalid, counted from the minimum',
    call: 'resolve',
    args: [
      50,
      MACHINE_GROUPS,
      [
        { key: 'material', value: 'steel' },
        { key: 'length', value: 2.25 },
      ],
      false,
    ],
    expected: { valid: false, errors: ['off-step:length'] },
  },
  {
    name: 'a decimal step absorbs float error (0.3 is three steps of 0.1)',
    call: 'resolve',
    args: [
      0,
      [
        {
          key: 'thickness',
          label: 'Thickness',
          type: 'number',
          required: true,
          min: 0,
          step: 0.1,
          price: NONE,
        },
      ],
      [{ key: 'thickness', value: 0.3 }],
      false,
    ],
    expected: { valid: true, errors: [] },
  },
  {
    name: 'an unanswered option keyed constructor is not set',
    call: 'resolve',
    args: [
      10,
      [
        {
          key: 'constructor',
          label: 'Constructor',
          type: 'choice',
          required: false,
          values: [{ key: 'lego', label: 'Lego', price: NONE }],
        },
        {
          key: 'manual',
          label: 'Printed manual',
          type: 'toggle',
          required: false,
          price: NONE,
          visibleWhen: [{ groupKey: 'constructor', operator: 'is-set' }],
        },
        {
          key: 'hint',
          label: 'Hint',
          type: 'text',
          required: false,
          price: NONE,
          visibleWhen: [{ groupKey: 'constructor', operator: 'is-not-set' }],
        },
      ],
      [],
      false,
    ],
    expected: { visibleKeys: ['constructor', 'hint'], valid: true },
  },
  {
    name: 'validate: a pick-several whose maximum is 0 can never be answered',
    call: 'validate',
    args: [
      [
        {
          key: 'extras',
          label: 'Extras',
          type: 'multi-choice',
          required: true,
          maxSelected: 0,
          values: [{ key: 'case', label: 'Case', price: NONE }],
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'MULTI_MAX_TOO_LOW',
        message: '“Extras”: allow at least one pick, or leave the maximum empty for no limit.',
        groupIndex: 0,
        groupKey: 'extras',
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: a pick-several may not pre-select more choices than its maximum',
    call: 'validate',
    args: [
      [
        {
          key: 'extras',
          label: 'Extras',
          type: 'multi-choice',
          required: false,
          maxSelected: 1,
          values: [
            { key: 'case', label: 'Case', price: NONE, default: true },
            { key: 'strap', label: 'Strap', price: NONE, default: true },
          ],
        },
        {
          key: 'sauces',
          label: 'Sauces',
          type: 'multi-choice',
          required: false,
          maxSelected: 2,
          values: [
            { key: 'mild', label: 'Mild', price: NONE, default: true },
            { key: 'hot', label: 'Hot', price: NONE, default: true },
            { key: 'smoky', label: 'Smoky', price: NONE },
          ],
        },
        {
          key: 'toppings',
          label: 'Toppings',
          type: 'multi-choice',
          required: false,
          values: [
            { key: 'nuts', label: 'Nuts', price: NONE, default: true },
            { key: 'seeds', label: 'Seeds', price: NONE, default: true },
          ],
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'MULTI_DEFAULTS_TOO_MANY',
        message:
          '“Extras” pre-selects more choices than shoppers may pick. Pre-select fewer, or raise the maximum.',
        groupIndex: 0,
        groupKey: 'extras',
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: two choices of one option may not share a name, in any case or spacing',
    call: 'validate',
    args: [
      [
        {
          key: 'size',
          label: 'Size',
          type: 'choice',
          required: true,
          values: [
            { key: 'small', label: 'Small', price: NONE },
            { key: 'medium', label: ' SMALL ', price: NONE },
            { key: 'large', label: 'small', price: NONE },
          ],
        },
        {
          key: 'fit',
          label: 'Fit',
          type: 'multi-choice',
          required: false,
          values: [{ key: 'small', label: 'Small', price: NONE }],
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'VALUE_LABEL_DUPLICATE',
        message: 'Two choices of “Size” have the same name.',
        groupIndex: 0,
        groupKey: 'size',
        valueKey: 'medium',
      },
    ],
  },
  {
    name: 'validate: an amount over 1,000,000,000 and a starting value between steps',
    call: 'validate',
    args: [
      [
        {
          key: 'len',
          label: 'Length',
          type: 'number',
          required: true,
          min: 0.5,
          step: 1,
          defaultValue: 1,
          price: { mode: 'per-unit', amount: 1000000001 },
        },
      ],
      false,
      '',
    ],
    expected: [
      {
        severity: 'error',
        code: 'NUMBER_DEFAULT_STEP',
        message: '“Length”: the starting value must be a whole number of steps from the minimum.',
        groupIndex: 0,
        groupKey: 'len',
        valueKey: null,
      },
      {
        severity: 'error',
        code: 'PRICE_AMOUNT_INVALID',
        message: 'Prices on “Length” must be between 0 and 1,000,000,000.',
        groupIndex: 0,
        groupKey: 'len',
        valueKey: null,
      },
    ],
  },
  {
    name: 'validate: two long texts at 2000 characters could overflow once escaped',
    call: 'validate',
    args: [LONG_TEXT_GROUPS.slice(0, 2), false, ''],
    expected: [
      {
        severity: 'warning',
        code: 'CONFIGURATION_TOO_LONG',
        message:
          'Filled in to their limits, these options could exceed 8000 characters and be refused at checkout. Use fewer options, or lower the character limits of the text options.',
        groupIndex: null,
        groupKey: null,
        valueKey: null,
      },
    ],
  },
  {
    name: 'parse: type synonyms, bare prices, a maximum of 0, capped amounts, clipped labels',
    call: 'parseGroups',
    args: [
      [
        { label: 'Gift wrap', type: 'checkbox', price: '2.5' },
        {
          label: 'Extras',
          type: 'Multi Choice',
          maxSelected: 0,
          values: [{ label: 'Case', price: 2000000000 }],
        },
        { label: 'Artwork', type: 'file' },
        { label: 'Finish', type: 'dropdown', values: [{ label: 'Gold' }] },
        { label: 'a'.repeat(119) + ' tail', type: 'bogus' },
        { label: 'b'.repeat(119) + String.fromCharCode(0xd83d, 0xde00), type: 'toggle' },
      ],
    ],
    expected: [
      {
        key: 'gift-wrap',
        label: 'Gift wrap',
        type: 'toggle',
        required: false,
        price: { mode: 'fixed', amount: 2.5 },
      },
      {
        key: 'extras',
        label: 'Extras',
        type: 'multi-choice',
        required: false,
        display: 'buttons',
        values: [{ key: 'case', label: 'Case', price: { mode: 'fixed', amount: 1000000000 } }],
      },
      {
        key: 'artwork',
        label: 'Artwork',
        type: 'upload',
        required: false,
        price: NONE,
        accept: 'any',
        maxFiles: 1,
      },
      {
        key: 'finish',
        label: 'Finish',
        type: 'choice',
        required: false,
        display: 'buttons',
        values: [{ key: 'gold', label: 'Gold', price: NONE }],
      },
      { key: 'a'.repeat(119), label: 'a'.repeat(119), type: 'text', required: false, price: NONE },
      {
        key: 'b'.repeat(119),
        label: 'b'.repeat(119),
        type: 'toggle',
        required: false,
        price: NONE,
      },
    ],
  },
  {
    name: 'label: line separators collapse, a clip never splits an emoji, non-text reads as text',
    call: 'label',
    args: [
      [
        {
          label: 'Note',
          valueLabel: 'a' + String.fromCharCode(0x2028) + 'b' + String.fromCharCode(0x85) + 'c',
        },
        { label: 'Emoji', valueLabel: 'x'.repeat(78) + String.fromCharCode(0xd83d, 0xde00) + 'y' },
        { label: ['not', 'text'], valueLabel: 7 },
      ],
    ],
    expected: 'Note: a b c · Emoji: ' + 'x'.repeat(78) + '… · 7',
  },
  {
    name: 'details: labels that are not text never throw',
    call: 'details',
    args: [
      [
        { label: { toString: 5 }, valueLabel: 'A3' },
        { label: 'Size', valueLabel: ['x'] },
      ],
    ],
    expected: 'A3\nSize: ',
  },
  {
    name: 'effective variant: the index of the matching override',
    call: 'effectiveVariant',
    args: [GLOSSY, { size: 'a4' }, ['size']],
    expected: 1,
  },
  {
    name: 'effective variant: no match is the default d',
    call: 'effectiveVariant',
    args: [GLOSSY, { size: 'a2' }, ['size']],
    expected: 'd',
  },
  {
    name: 'effective variant: a hidden source is the default d',
    call: 'effectiveVariant',
    args: [GLOSSY, { size: 'a3' }, []],
    expected: 'd',
  },
  {
    name: 'price variant key: a value',
    call: 'priceVariantKey',
    args: ['p1', 'paper', 'glossy', 2],
    expected: 'pv:p1|paper|glossy|2',
  },
  {
    name: 'price variant key: a priced option at its default',
    call: 'priceVariantKey',
    args: ['p1', 'engraving-text', null, 'd'],
    expected: 'pv:p1|engraving-text|d',
  },
  { name: 'is image: an image MIME type', call: 'isImage', args: [PHOTO], expected: true },
  {
    name: 'is image: a PDF is a link',
    call: 'isImage',
    args: [{ ...PHOTO, mimeType: 'application/pdf' }],
    expected: false,
  },
  { name: 'is image: junk is not an image', call: 'isImage', args: [null], expected: false },
  {
    name: 'file ref: an id of dots only is refused',
    call: 'isFileRef',
    args: [{ ...PHOTO, id: '..' }],
    expected: false,
  },
  {
    name: 'mint key: a missing taken list and a blank fallback read as empty and option',
    call: 'mintKey',
    args: ['', null, ''],
    expected: 'option',
  },
]
// ── END SHARED PARITY TABLE ─────────────────────────────────────────────────

const SUBSET_CALLS: ProductOptionsCall[] = ['resolve', 'resolveForRow']

/** A `resolve` row states only some fields; every other row states the whole result. */
const comparable = (call: ProductOptionsCall, result: unknown, expected: unknown): unknown => {
  if (SUBSET_CALLS.indexOf(call) === -1 || !result || typeof result !== 'object') {
    return result
  }
  const picked: Record<string, unknown> = {}
  Object.keys(expected as Record<string, unknown>).forEach((field) => {
    picked[field] = (result as Record<string, unknown>)[field]
  })
  return picked
}

describe('product options — storefront copy against the shared parity table', () => {
  const api = loadApi()

  it.each(PRODUCT_OPTIONS_FIXTURES.map((fixture) => [`${fixture.call}: ${fixture.name}`, fixture]))(
    '%s',
    (_name, fixture) => {
      const row = fixture as ProductOptionsFixture
      const result = api[row.call](...row.args)
      expect(comparable(row.call, result, row.expected)).toEqual(row.expected)
    }
  )

  it('is one sentinel-wrapped block that follows the splice rules', () => {
    const source = generateProductOptionsHelperCode()
    const lines = source.split('\n')
    expect(lines[0]).toBe(PRODUCT_OPTIONS_HELPERS_OPENING)
    expect(lines[lines.length - 1]).toBe(PRODUCT_OPTIONS_HELPERS_CLOSING)
    expect(source).not.toContain('`')
    expect(source).not.toContain('${')
    expect(source).not.toContain('params.')
    expect(source).not.toContain('\\')

    // The handler-entry resolver picks the first declared two-parameter function.
    const declared = /function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/g
    let match = declared.exec(source)
    let count = 0
    while (match !== null) {
      const arity = match[2].trim() === '' ? 0 : match[2].split(',').length
      expect(match[1].indexOf('__po')).toBe(0)
      expect(arity === 1 || arity >= 3).toBe(true)
      count += 1
      match = declared.exec(source)
    }
    expect(count).toBeGreaterThan(20)
  })
})
