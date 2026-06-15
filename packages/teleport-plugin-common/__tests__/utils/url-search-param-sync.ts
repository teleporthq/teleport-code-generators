import generator from '@babel/generator'
import * as types from '@babel/types'
import {
  buildUrlSearchParamInitExpr,
  buildUrlReadBackEffect,
  buildUrlWriteBackEffect,
  buildUrlWriteBackStatements,
} from '../../src/utils/url-search-param-sync'

const codeOf = (node: types.Node): string => generator(node).code

describe('url-search-param-sync builders', () => {
  it('buildUrlSearchParamInitExpr reads window.location.search with a fallback', () => {
    const code = codeOf(buildUrlSearchParamInitExpr('searchKeyword', types.stringLiteral('')))
    expect(code).toContain('typeof window')
    expect(code).toContain('new URLSearchParams(window.location.search).get("searchKeyword")')
  })

  it('buildUrlReadBackEffect uses the explicit setter and normalizes string|string[]', () => {
    const code = codeOf(
      buildUrlReadBackEffect('ds_0_searchQuery', 'searchKeyword', 'setDs_0_searchQuery')
    )
    expect(code).toContain('router.query.searchKeyword')
    expect(code).toContain('setDs_0_searchQuery(')
    // Functional bail-out is the loop guard.
    expect(code).toContain('prev === __nextValue ? prev : __nextValue')
    expect(code).toContain('Array.isArray(__urlValue)')
    expect(code).toContain('router.isReady')
  })

  it('buildUrlReadBackEffect derives the setter from the state key when omitted', () => {
    const code = codeOf(buildUrlReadBackEffect('selectedCategory', 'categoryFilter'))
    expect(code).toContain('setSelectedCategory(')
  })

  it('buildUrlWriteBackStatements supports a member-expression value (debounced query)', () => {
    const stmts = buildUrlWriteBackStatements(
      types.memberExpression(types.identifier('ds_0_state'), types.identifier('debouncedQuery')),
      'searchKeyword'
    )
    const code = codeOf(types.blockStatement(stmts))
    expect(code).toContain('const __nextQuery = {')
    expect(code).toContain('delete __nextQuery.searchKeyword')
    expect(code).toContain('__nextQuery.searchKeyword = String(ds_0_state.debouncedQuery)')
    expect(code).toContain('ds_0_state.debouncedQuery === ""')
    // Skip-if-equal guard — the other half of the loop protection.
    expect(code).toContain('if (__nextQuery.searchKeyword === router.query.searchKeyword) return')
    expect(code).toContain('router.replace(')
    expect(code).toContain('shallow: true')
  })

  it('uses bracket notation for non-identifier param keys', () => {
    const code = codeOf(buildUrlWriteBackEffect('value', 'sort-by'))
    expect(code).toContain('__nextQuery["sort-by"]')
    expect(code).toContain('router.query["sort-by"]')
  })

  it('keeps a non-empty default OUT of the URL (deletes when value equals the default)', () => {
    const code = codeOf(buildUrlWriteBackEffect('sortBy', 'sortBy', 'name-asc'))
    expect(code).toContain('sortBy === ""')
    expect(code).toContain('sortBy == null')
    expect(code).toContain('sortBy === "name-asc"')
    expect(code).toContain('delete __nextQuery.sortBy')
  })

  it('an empty default does not add an extra equality check (byte-compatible with category)', () => {
    const withEmpty = codeOf(buildUrlWriteBackEffect('selectedCategory', 'categoryFilter', ''))
    const withNone = codeOf(buildUrlWriteBackEffect('selectedCategory', 'categoryFilter'))
    expect(withEmpty).toBe(withNone)
    // Only the empty/null pair — no third `=== "..."` clause.
    expect(withEmpty).toContain('selectedCategory === ""')
    expect(withEmpty).toContain('selectedCategory == null')
    expect(withEmpty.match(/selectedCategory ===/g)?.length).toBe(1)
  })

  it('read-back resolves a missing key to the non-empty default (so the select never blanks)', () => {
    const code = codeOf(buildUrlReadBackEffect('sortBy', 'sortBy', 'setSortBy', 'name-asc'))
    // string | array | missing all fall back to the default, matching the
    // write-back delete-on-default and the useState `?? "name-asc"` init.
    expect(code).toContain('__urlValue || "name-asc"')
    expect(code).toContain('__urlValue[0] || "name-asc"')
    // No empty-string fallback should remain — every branch resolves to the default.
    expect(code).not.toContain('|| ""')
  })

  it('read-back with an empty default keeps the original "" fallback (category parity)', () => {
    const withEmpty = codeOf(
      buildUrlReadBackEffect('selectedCategory', 'categoryFilter', 'setSelectedCategory', '')
    )
    const withNone = codeOf(
      buildUrlReadBackEffect('selectedCategory', 'categoryFilter', 'setSelectedCategory')
    )
    expect(withEmpty).toBe(withNone)
  })
})
