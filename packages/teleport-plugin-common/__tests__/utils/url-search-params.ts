import generator from '@babel/generator'
import * as types from '@babel/types'
import {
  buildNextJsUrlSearchParamsPrelude,
  buildStaticUrlSearchParamsPrelude,
} from '../../src/utils/url-search-params'

const gen = (statements: types.Statement[]): string =>
  statements.map((s) => generator(s).code).join('\n')

describe('buildNextJsUrlSearchParamsPrelude', () => {
  it('returns empty result when no params are declared', () => {
    const result = buildNextJsUrlSearchParamsPrelude(undefined)
    expect(result.statements).toEqual([])
    expect(result.registry).toEqual({})
    expect(result.prefixMap).toEqual({})
  })

  it('emits a `const router = useRouter()` declaration and registers defaults', () => {
    const result = buildNextJsUrlSearchParamsPrelude([
      { key: 'category', defaultValue: 'food' },
      { key: 'minPrice' },
    ])
    const code = gen(result.statements)
    expect(code).toContain('const router = useRouter()')
    expect(result.registry).toEqual({
      category: { defaultValue: 'food' },
      minPrice: { defaultValue: undefined },
    })
    expect(result.prefixMap.urlSearchParams).toBe('router.query')
  })
})

describe('buildStaticUrlSearchParamsPrelude', () => {
  it('returns empty result when no params are declared', () => {
    const result = buildStaticUrlSearchParamsPrelude(undefined)
    expect(result.statements).toEqual([])
  })

  it('emits a safe URLSearchParams read guarded by a window check', () => {
    const result = buildStaticUrlSearchParamsPrelude([{ key: 'category', defaultValue: 'food' }])
    const code = gen(result.statements)
    expect(code).toContain('const __urlSearchParams')
    expect(code).toContain('URLSearchParams')
    expect(code).toContain('typeof window !== "undefined"')
    expect(result.prefixMap.urlSearchParams).toBe('__urlSearchParams')
  })
})
