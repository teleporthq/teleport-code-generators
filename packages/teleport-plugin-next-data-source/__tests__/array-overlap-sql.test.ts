import { generateArrayOverlapSqlCode } from '../src/array-overlap-sql'
import { generateLocalizedColumnsHelper } from '../src/localized-columns'

/**
 * An `array_overlap` filter over a list column. The emitted SQL was run
 * against PostgreSQL over every form a list cell takes (JSON array, a
 * hand-typed comma list, a native array literal, blank, padded); these pin the
 * shape that run proved.
 */

type OverlapSql = (columns: string[], param: string) => string

const arrayOverlapSql = new Function(
  generateArrayOverlapSqlCode() + '\nreturn arrayOverlapSql'
)() as OverlapSql

describe('arrayOverlapSql', () => {
  it('reads a JSON array, a comma list and an array literal as one text[]', () => {
    const sql = arrayOverlapSql(['tags'], '$1')
    expect(sql).toContain("LIKE '[%' THEN ARRAY(SELECT jsonb_array_elements_text(")
    expect(sql).toContain("LIKE '{%' THEN")
    expect(sql).toContain("regexp_split_to_array(NULLIF(BTRIM(COALESCE(tags::text, '')), ''),")
    expect(sql).toMatch(/&& \$1::text\[\]$/)
  })

  it('never casts a comma list to jsonb', () => {
    // The old `NULLIF(tags, '')::jsonb` threw on `react, css` and failed the
    // whole listing query.
    expect(arrayOverlapSql(['tags'], '$1')).not.toContain("NULLIF(tags, '')::jsonb")
  })

  it('matches any of a translatable list and its language copies', () => {
    const sql = arrayOverlapSql(['"tags"', '"es_tags"'], '$2')
    expect(sql.startsWith('(')).toBe(true)
    expect(sql.split(' OR ')).toHaveLength(2)
    expect(sql.match(/&& \$2::text\[\]/g)).toHaveLength(2)
  })
})

describe('localizedColumnList', () => {
  const localizedColumnList = new Function(
    generateLocalizedColumnsHelper({ tags: { es: 'es_tags', fr: 'fr_tags' } }) +
      '\nreturn localizedColumnList'
  )() as (field: string) => string[] | null

  it('names a translatable column with every copy the schema has', () => {
    expect(localizedColumnList('tags')).toEqual(['"tags"', '"es_tags"', '"fr_tags"'])
  })

  it('answers null for a column with no copies', () => {
    expect(localizedColumnList('category_filter_ids')).toBeNull()
  })
})
