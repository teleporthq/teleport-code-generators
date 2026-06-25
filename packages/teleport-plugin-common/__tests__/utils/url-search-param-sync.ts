import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  buildUrlWriteBackEffect,
  buildUrlReadBackEffect,
} from '../../src/utils/url-search-param-sync'

// NOTE: these assertions check the RAW `@babel/generator` output (double
// quotes, semicolons, no prettier), not the prettified code that lands in a
// generated project — so string literals appear as `""`, not `''`.
const codeOf = (node: types.Node): string => generator(node).code

describe('URLSearchParamSync.buildUrlWriteBackEffect', () => {
  it('emits a loop-free state→URL write-back for a bare state identifier (dropdown case)', () => {
    const effect = buildUrlWriteBackEffect(
      'categoryFilter',
      types.identifier('selectedCategory'),
      types.identifier('selectedCategory')
    )
    const code = codeOf(effect)

    // SSR + router-ready guards.
    expect(code).toContain('if (typeof window === "undefined") return')
    expect(code).toContain('if (!router.isReady) return')
    // Snapshot the current query, then set or delete the bound key.
    expect(code).toContain('const __nextQuery =')
    expect(code).toContain('...router.query')
    expect(code).toContain('if (selectedCategory === "" || selectedCategory == null)')
    expect(code).toContain('delete __nextQuery.categoryFilter')
    expect(code).toContain('__nextQuery.categoryFilter = String(selectedCategory)')
    // Skip-if-equal guard prevents a redundant replace (the loop breaker on the URL side).
    expect(code).toContain('if (__nextQuery.categoryFilter === router.query.categoryFilter) return')
    expect(code).toContain('shallow: true')
    // Deps: the value + router.isReady (so it re-runs once the router hydrates).
    expect(code).toContain('}, [selectedCategory, router.isReady])')
  })

  it('emits the write-back reading a member expression (search debounced-query case)', () => {
    const debounced = () =>
      types.memberExpression(types.identifier('ds_0_state'), types.identifier('debouncedQuery'))
    const effect = buildUrlWriteBackEffect('searchKeyword', debounced(), debounced())
    const code = codeOf(effect)

    // The value pushed to the URL is read from the combined state object,
    // not a bare identifier — this is the generalization the search input needs.
    expect(code).toContain(
      'if (ds_0_state.debouncedQuery === "" || ds_0_state.debouncedQuery == null)'
    )
    expect(code).toContain('__nextQuery.searchKeyword = String(ds_0_state.debouncedQuery)')
    expect(code).toContain('if (__nextQuery.searchKeyword === router.query.searchKeyword) return')
    // Dependency is the debounced member expression, so the URL only updates
    // after the debounce commits — never on every keystroke.
    expect(code).toContain('}, [ds_0_state.debouncedQuery, router.isReady])')
  })

  it('uses bracket notation for URL keys that are not valid JS identifiers', () => {
    const effect = buildUrlWriteBackEffect(
      'search-keyword',
      types.identifier('q'),
      types.identifier('q')
    )
    const code = codeOf(effect)

    expect(code).toContain('delete __nextQuery["search-keyword"]')
    expect(code).toContain('__nextQuery["search-keyword"] = String(q)')
    expect(code).not.toContain('__nextQuery.search-keyword')
  })
})

describe('URLSearchParamSync.buildUrlReadBackEffect', () => {
  it('emits a loop-free URL→state read-back via functional setState', () => {
    const effect = buildUrlReadBackEffect('searchKeyword', 'setDs_0_searchQuery')
    const code = codeOf(effect)

    expect(code).toContain('if (!router.isReady) return')
    expect(code).toContain('const __urlValue = router.query.searchKeyword')
    // Normalizes string | string[] | undefined to a string.
    expect(code).toContain('typeof __urlValue === "string"')
    expect(code).toContain('Array.isArray(__urlValue)')
    // Functional setState bail-out — the loop breaker on the state side.
    expect(code).toContain('setDs_0_searchQuery(prev => prev === __nextValue ? prev : __nextValue)')
    expect(code).toContain('}, [router.query.searchKeyword, router.isReady])')
  })

  it('uses bracket notation in the deps + read for non-identifier keys', () => {
    const effect = buildUrlReadBackEffect('search-keyword', 'setQ')
    const code = codeOf(effect)

    expect(code).toContain('const __urlValue = router.query["search-keyword"]')
    expect(code).toContain('}, [router.query["search-keyword"], router.isReady])')
  })
})
