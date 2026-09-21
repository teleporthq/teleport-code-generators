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
