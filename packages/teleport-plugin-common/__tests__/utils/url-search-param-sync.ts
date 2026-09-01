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
  it('delegates the write to the shared query writer (dropdown case)', () => {
    const effect = buildUrlWriteBackEffect(
      'categoryFilter',
      types.identifier('selectedCategory'),
      types.identifier('selectedCategory')
    )
    const code = codeOf(effect)

    // SSR + router-ready guards.
    expect(code).toContain('if (typeof window === "undefined") return')
    expect(code).toContain('if (!router.isReady) return')

    // ⛔ The effect must NOT build the next query itself. Spreading
    // `router.query` here is what let two controls writing in one flush erase
    // each other's keys — and, through their read-backs, oscillate forever.
    expect(code).not.toContain('__nextQuery')
    expect(code).not.toContain('...router.query')
    expect(code).not.toContain('router.replace')

    // One key, one call. `undefined` is the writer's "remove this key".
    expect(code).toContain(
      '__tqWriteQueryParam("categoryFilter", selectedCategory === "" || selectedCategory == null ? undefined : selectedCategory)'
    )

    // ⛔ `router.query` is deliberately NOT a dependency. It was added once as a
    // way to RE-ASSERT a key another writer had dropped, which is precisely the
    // edge that closed the loop; with clobbering fixed at its source there is
    // nothing to re-assert.
    expect(code).toContain('}, [selectedCategory, router.isReady])')
    expect(code).not.toContain('router.isReady, router.query]')
  })

  it('emits the write-back reading a member expression (search debounced-query case)', () => {
    const debounced = () =>
      types.memberExpression(types.identifier('ds_0_state'), types.identifier('debouncedQuery'))
    const effect = buildUrlWriteBackEffect('searchKeyword', debounced(), debounced())
    const code = codeOf(effect)

    // The value pushed to the URL is read from the combined state object,
    // not a bare identifier — this is the generalization the search input needs.
    expect(code).toContain(
      '__tqWriteQueryParam("searchKeyword", ds_0_state.debouncedQuery === "" || ds_0_state.debouncedQuery == null ? undefined : ds_0_state.debouncedQuery)'
    )
    // Dependency is the debounced member expression, so the URL only updates
    // after the debounce commits — never on every keystroke.
    expect(code).toContain('}, [ds_0_state.debouncedQuery, router.isReady])')
  })

  it('passes a non-identifier URL key through as a plain string argument', () => {
    const effect = buildUrlWriteBackEffect(
      'search-keyword',
      types.identifier('q'),
      types.identifier('q')
    )
    const code = codeOf(effect)

    // The writer indexes with `next[key]`, so an awkward key needs no bracket
    // gymnastics at the call site any more.
    expect(code).toContain('__tqWriteQueryParam("search-keyword"')
  })

  it('also removes the key when the value equals a non-empty default (clean canonical URL)', () => {
    const effect = buildUrlWriteBackEffect(
      'sortBy',
      types.identifier('sortBy'),
      types.identifier('sortBy'),
      types.stringLiteral('name-asc')
    )
    const code = codeOf(effect)

    // The default routes to the remove branch, so loading the page at its
    // default sort never writes a sticky `?sortBy=name-asc`.
    expect(code).toContain('sortBy === "" || sortBy == null || sortBy === "name-asc" ? undefined')
  })

  it('omits the default clause when no default is supplied', () => {
    const withoutDefault = codeOf(
      buildUrlWriteBackEffect('sortBy', types.identifier('sortBy'), types.identifier('sortBy'))
    )
    expect(withoutDefault).toContain('sortBy === "" || sortBy == null ? undefined : sortBy')
    expect(withoutDefault).not.toContain('=== "name-asc"')
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

  it('resolves an absent/empty URL value to a non-empty default rather than ""', () => {
    const effect = buildUrlReadBackEffect('sortBy', 'setSortBy', types.stringLiteral('name-asc'))
    const code = codeOf(effect)

    // The normalized (string | string[] | undefined) value falls through to the
    // default when empty — this is what stops the default from being clobbered
    // to "" on first load (which forced an extra unsorted fetch).
    expect(code).toContain('|| "name-asc"')
    expect(code).toContain('setSortBy(prev => prev === __nextValue ? prev : __nextValue)')
  })

  it('emits no default fallback when none is supplied (byte-identical fallback)', () => {
    const code = codeOf(buildUrlReadBackEffect('sortBy', 'setSortBy'))
    expect(code).not.toContain('name-asc')
    // The bare normalized expression still ends in the "" missing-key fallback.
    expect(code).toContain('const __nextValue =')
  })
})
