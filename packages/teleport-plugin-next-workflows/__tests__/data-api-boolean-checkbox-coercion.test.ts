import { generateDataAPIRoute } from '../src/data-api-route-generator'

// Regression guard for "Edit Press Item" data loss: an unchecked HTML
// checkbox is omitted from FormData entirely, so `general-extract-form-data`
// resolves it to '' / undefined — never `false`. Before this fix,
// `coerceValueForPgColumn` had no `boolean` branch, so that '' fell through
// to the generic empty-string-to-null guard and was written as SQL NULL: a
// silent "not featured" -> NULL corruption when the column is nullable, and a
// hard 23502 not-null-violation (surfaced to the user as "update failed")
// when the boolean column is NOT NULL.
describe('data-api route generator: coerceValueForPgColumn boolean column handling', () => {
  const code = generateDataAPIRoute()

  it('emits an explicit boolean branch ahead of the ARRAY / generic handling', () => {
    expect(code).toContain('function coerceValueForPgColumn')
    expect(code).toMatch(/if \(dt === 'boolean'\)/)
  })

  it('is invoked from both handleCreate and handleUpdate', () => {
    const handleCreateIdx = code.indexOf('async function handleCreate')
    const handleUpdateIdx = code.indexOf('async function handleUpdate')
    const handleDeleteIdx = code.indexOf('async function handleDelete')
    expect(handleCreateIdx).toBeGreaterThan(0)
    expect(handleUpdateIdx).toBeGreaterThan(handleCreateIdx)
    expect(handleDeleteIdx).toBeGreaterThan(handleUpdateIdx)

    const handleCreateBody = code.slice(handleCreateIdx, handleUpdateIdx)
    const handleUpdateBody = code.slice(handleUpdateIdx, handleDeleteIdx)
    expect(handleCreateBody).toContain('coerceValueForPgColumn(col, val, colTypes)')
    expect(handleUpdateBody).toContain('coerceValueForPgColumn(col, val, colTypes)')
  })
})

// Behaviour tests: spin up the emitted helper in a fresh JS sandbox and
// exercise every boolean coercion path, mirroring the pattern established by
// data-api-uuid-coercion.test.ts (the generated file is one big template
// literal, so the helper is extracted by balanced-brace matching rather than
// imported directly).
describe('data-api route generator: coerceValueForPgColumn runtime behaviour', () => {
  const code = generateDataAPIRoute()

  const extractFunctionSource = (haystack: string, funcDecl: string): string => {
    const startIdx = haystack.indexOf(funcDecl)
    if (startIdx === -1) {
      throw new Error('Helper not found in generated code: ' + funcDecl)
    }
    let depth = 0
    let i = haystack.indexOf('{', startIdx)
    if (i === -1) {
      throw new Error('No opening brace after ' + funcDecl)
    }
    for (; i < haystack.length; i++) {
      const ch = haystack.charAt(i)
      if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          return haystack.slice(startIdx, i + 1)
        }
      }
    }
    throw new Error('Unbalanced braces for ' + funcDecl)
  }

  const varDeclSource = (haystack: string, varDecl: string): string => {
    const startIdx = haystack.indexOf(varDecl)
    if (startIdx === -1) {
      throw new Error('Var declaration not found in generated code: ' + varDecl)
    }
    const endIdx = haystack.indexOf(';', startIdx)
    return haystack.slice(startIdx, endIdx + 1)
  }

  const booleanTrueStringsSource = varDeclSource(code, 'var BOOLEAN_TRUE_STRINGS')
  const splitCommaSource = extractFunctionSource(code, 'function splitCommaOrPgArrayString')
  const helperSource = extractFunctionSource(code, 'function coerceValueForPgColumn')

  const factory = new Function(
    booleanTrueStringsSource +
      '\n' +
      splitCommaSource +
      '\n' +
      helperSource +
      '\nreturn coerceValueForPgColumn;'
  )
  const coerceValueForPgColumn = factory() as (
    col: string,
    val: unknown,
    colTypes: Record<string, string>
  ) => unknown

  const boolCol = 'is_featured'
  const colTypes: Record<string, string> = {
    is_featured: 'boolean',
    tags: 'ARRAY',
    name: 'text',
  }

  it('coerces an unchecked-checkbox empty string to false (not NULL)', () => {
    expect(coerceValueForPgColumn(boolCol, '', colTypes)).toBe(false)
  })

  it('coerces undefined (field never present in the submitted body) to false', () => {
    expect(coerceValueForPgColumn(boolCol, undefined, colTypes)).toBe(false)
  })

  it('coerces null to false', () => {
    expect(coerceValueForPgColumn(boolCol, null, colTypes)).toBe(false)
  })

  it('coerces checkbox truthy strings ("on", "true", "1") to true', () => {
    expect(coerceValueForPgColumn(boolCol, 'on', colTypes)).toBe(true)
    expect(coerceValueForPgColumn(boolCol, 'true', colTypes)).toBe(true)
    expect(coerceValueForPgColumn(boolCol, '1', colTypes)).toBe(true)
  })

  it('is case-insensitive and trims whitespace on truthy strings', () => {
    expect(coerceValueForPgColumn(boolCol, 'On', colTypes)).toBe(true)
    expect(coerceValueForPgColumn(boolCol, ' TRUE ', colTypes)).toBe(true)
  })

  it('coerces falsy strings ("off", "false", "0") to false', () => {
    expect(coerceValueForPgColumn(boolCol, 'off', colTypes)).toBe(false)
    expect(coerceValueForPgColumn(boolCol, 'false', colTypes)).toBe(false)
    expect(coerceValueForPgColumn(boolCol, '0', colTypes)).toBe(false)
  })

  it('passes real booleans through unchanged', () => {
    expect(coerceValueForPgColumn(boolCol, true, colTypes)).toBe(true)
    expect(coerceValueForPgColumn(boolCol, false, colTypes)).toBe(false)
  })

  it('treats any non-zero number as true and zero as false', () => {
    expect(coerceValueForPgColumn(boolCol, 1, colTypes)).toBe(true)
    expect(coerceValueForPgColumn(boolCol, 0, colTypes)).toBe(false)
  })

  it('does not affect non-boolean columns (ARRAY / text untouched)', () => {
    expect(coerceValueForPgColumn('tags', 'a,b,c', colTypes)).toEqual(['a', 'b', 'c'])
    expect(coerceValueForPgColumn('name', '', colTypes)).toBe('')
  })
})
