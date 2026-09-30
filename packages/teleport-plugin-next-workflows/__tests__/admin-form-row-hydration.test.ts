import { readFileSync } from 'fs'
import { join } from 'path'

// The admin form hydration helpers are emitted verbatim into the generated
// page from a template literal in the plugin. Pull them out of the source and
// run them, so what is asserted is what the page runs.
const pluginSource = readFileSync(join(__dirname, '../src/workflow-component-plugin.ts'), 'utf8')

const extractHelper = (name: string): string => {
  const match = pluginSource.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`))
  if (!match) {
    throw new Error(`helper ${name} not found in the plugin source`)
  }
  // Backticks are escaped inside the template literal.
  return match[0].replace(/\\`/g, '`')
}

const helpers = new Function(
  `${extractHelper('__normalizeTagsForFormInput')}\n${extractHelper('__normalizeAdminFormRow')}\n` +
    'return { normalizeRow: __normalizeAdminFormRow, normalizeTags: __normalizeTagsForFormInput }'
)() as {
  normalizeRow: (row: unknown, defaults: Record<string, unknown>) => Record<string, unknown>
  normalizeTags: (value: unknown) => string
}

const DEFAULTS = { name: '', tags: '', es_name: '', es_tags: '', zh_tags: '' }

describe('__normalizeAdminFormRow', () => {
  it('keeps the per-language columns the form binds', () => {
    const row = { id: 3, name: 'Lamp', es_name: 'Lámpara', color: 'red' }
    expect(helpers.normalizeRow(row, DEFAULTS)).toEqual({
      name: 'Lamp',
      tags: '',
      es_name: 'Lámpara',
      es_tags: '',
      zh_tags: '',
    })
  })

  it('reshapes a language copy of the tags like the tags themselves', () => {
    const row = { tags: ['light', 'desk'], es_tags: '{"luz","escritorio"}', zh_tags: ['灯'] }
    expect(helpers.normalizeRow(row, DEFAULTS)).toMatchObject({
      tags: 'light, desk',
      es_tags: 'luz, escritorio',
      zh_tags: '灯',
    })
  })

  it('falls back to the default for a language the row has nothing for', () => {
    expect(helpers.normalizeRow({ name: 'Lamp', es_name: null }, DEFAULTS)).toMatchObject({
      es_name: '',
      es_tags: '',
    })
  })
})

describe('__normalizeAdminFormRow — a product loaded as stored', () => {
  const PRODUCT_DEFAULTS = {
    name: '',
    gallery_images: '',
    is_digital: false,
    is_gift_card: false,
    discounts: '',
  }

  it('shows a JSON gallery one URL per line, and keeps anything else as typed', () => {
    const row = { gallery_images: '["https://a.io/1.png","https://a.io/2.png"]' }
    expect(helpers.normalizeRow(row, PRODUCT_DEFAULTS).gallery_images).toBe(
      'https://a.io/1.png\nhttps://a.io/2.png'
    )
    expect(
      helpers.normalizeRow({ gallery_images: 'https://a.io/1.png' }, PRODUCT_DEFAULTS)
        .gallery_images
    ).toBe('https://a.io/1.png')
    expect(
      helpers.normalizeRow({ gallery_images: '[not json' }, PRODUCT_DEFAULTS).gallery_images
    ).toBe('[not json')
  })

  it('reads a flag that arrives as text as the boolean it is — "false" is not a ticked box', () => {
    const fromView = helpers.normalizeRow(
      { isDigital: 'true', isGiftCard: 'false' },
      PRODUCT_DEFAULTS
    )
    expect(fromView.is_digital).toBe(true)
    expect(fromView.is_gift_card).toBe(false)
    const fromPostgres = helpers.normalizeRow(
      { is_digital: 't', is_gift_card: 'f' },
      PRODUCT_DEFAULTS
    )
    expect(fromPostgres).toMatchObject({ is_digital: true, is_gift_card: false })
    const stored = helpers.normalizeRow({ is_digital: true, is_gift_card: false }, PRODUCT_DEFAULTS)
    expect(stored).toMatchObject({ is_digital: true, is_gift_card: false })
  })

  it('keeps the stored discounts, and a text field that merely says "true"', () => {
    const discounts = '[{"id":"d1","type":"fixed","value":10}]'
    const out = helpers.normalizeRow({ discounts, name: 'true' }, PRODUCT_DEFAULTS)
    expect(out.discounts).toBe(discounts)
    expect(out.name).toBe('true')
  })
})

describe('__normalizeTagsForFormInput', () => {
  it('shows the editor’s JSON list, a Postgres array and an array alike, and keeps plain text', () => {
    expect(helpers.normalizeTags('["light","desk"]')).toBe('light, desk')
    expect(helpers.normalizeTags('{"light","desk"}')).toBe('light, desk')
    expect(helpers.normalizeTags(['light', 'desk'])).toBe('light, desk')
    expect(helpers.normalizeTags('light, desk')).toBe('light, desk')
    expect(helpers.normalizeTags('[not json]')).toBe('[not json]')
    expect(helpers.normalizeTags(null)).toBe('')
  })
})
