import * as types from '@babel/types'
import generator from '@babel/generator'
import {
  QUERY_SYNC_REF_ID,
  QUERY_WRITER_ID,
  buildQuerySettledExpr,
  buildQuerySyncDeclarations,
  buildQueryWriteCall,
  ensureQuerySyncDeclarations,
  hasQuerySyncDeclarations,
} from '../../src/utils/url-query-writer'

const codeOf = (nodes: types.Statement[]): string =>
  generator(types.program(nodes) as types.Node).code

/**
 * A router that behaves like Next's.
 *
 * The two properties that caused the defect are reproduced faithfully:
 *   • `replace` resolves ASYNCHRONOUSLY, and `query` is only updated when it
 *     does — so a second writer running in the same tick still sees the old one;
 *   • `query` is a fresh object each time, as `makePublicRouterInstance` makes it.
 */
const makeRouter = (initialQuery: Record<string, string>) => {
  const replaced: Array<Record<string, string>> = []
  let resolveAll: Array<() => void> = []
  const router = {
    pathname: '/products',
    query: { ...initialQuery },
    replace(url: { query: Record<string, string> }) {
      replaced.push({ ...url.query })
      return new Promise<boolean>((resolve) => {
        resolveAll.push(() => {
          // Next applies the navigation, THEN resolves.
          router.query = { ...url.query }
          resolve(true)
        })
      })
    },
  }
  const settleAll = async (): Promise<void> => {
    while (resolveAll.length > 0) {
      const pending = resolveAll
      resolveAll = []
      pending.forEach((fn) => fn())
      await Promise.resolve()
      await Promise.resolve()
    }
  }
  return { router, replaced, settleAll }
}

/** Evaluates the emitted declarations and hands back the writer they define. */
const instantiate = (router: unknown) => {
  const code = codeOf(buildQuerySyncDeclarations())
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'useRef',
    'router',
    `${code}\nreturn { ref: ${QUERY_SYNC_REF_ID}, write: ${QUERY_WRITER_ID} }`
  )
  // tslint:disable-next-line:no-any
  const useRef = (initial: any) => ({ current: initial })
  return factory(useRef, router) as {
    ref: { current: { pending: Record<string, string> | null; inFlight: number } }
    // tslint:disable-next-line:no-any
    write: (key: string, value: any) => void
  }
}

describe('URLQueryWriter — emitted shape', () => {
  it('merges into the pending query, not into router.query', () => {
    // Babel prints objects multi-line; the assertions read better flattened.
    const code = codeOf(buildQuerySyncDeclarations()).replace(/\s+/g, ' ')

    expect(code).toContain('const base = __tqQuerySyncRef.current.pending || router.query')
    expect(code).toContain('const next = { ...base }')
    // The only bail: this key already holds the value we would write.
    expect(code).toContain('if (next[key] === base[key]) return')
    expect(code).toContain('__tqQuerySyncRef.current.pending = next')
    expect(code).toContain('__tqQuerySyncRef.current.inFlight += 1')
    // Released once every replace it was built from has settled, so an external
    // navigation is never merged into a stale snapshot.
    expect(code).toContain('__tqQuerySyncRef.current.pending = null')
    expect(code).toContain('shallow: true')
  })

  it('builds a call and a settled-check callers can compose', () => {
    expect(generator(buildQueryWriteCall('page', types.identifier('__statePage'))).code).toBe(
      '__tqWriteQueryParam("page", __statePage);'
    )
    expect(generator(buildQuerySettledExpr()).code).toBe('__tqQuerySyncRef.current.inFlight === 0')
  })

  it('declares itself once, after `const router = useRouter()`', () => {
    const routerDecl = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('router'),
        types.callExpression(types.identifier('useRouter'), [])
      ),
    ])
    const body: types.Statement[] = [routerDecl, types.returnStatement(types.nullLiteral())]

    expect(hasQuerySyncDeclarations(body)).toBe(false)
    expect(ensureQuerySyncDeclarations(body)).toBe(true)
    expect(body.length).toBe(4)
    expect(codeOf(body).indexOf('useRouter')).toBeLessThan(codeOf(body).indexOf(QUERY_SYNC_REF_ID))

    // A second plugin needing the same pair must not emit a duplicate hook —
    // that would also shift the hook order between renders.
    expect(ensureQuerySyncDeclarations(body)).toBe(false)
    expect(body.length).toBe(4)
  })
})

/**
 * ⛔ These run the generated code. Every other guard in this repo is a
 * source-text assertion, and effect INTERLEAVING is exactly what source text
 * cannot see — which is why the defect below shipped green.
 */
describe('URLQueryWriter — behaviour under a Next-like async router', () => {
  it('keeps both keys when two controls write in the same flush', async () => {
    // The live repro: on `?page=5`, picking a category writes the filter AND
    // resets the page, so both writers run before either replace has landed.
    const { router, replaced, settleAll } = makeRouter({ page: '5' })
    const { write } = instantiate(router)

    write('categoryFilter', 'Rings')
    write('page', undefined) // page 1 ⇒ remove the key

    expect(replaced).toHaveLength(2)
    // The SECOND write built on the first's payload rather than on the stale
    // `router.query` — this is the whole fix.
    expect(replaced[1]).toEqual({ categoryFilter: 'Rings' })

    await settleAll()
    expect(router.query).toEqual({ categoryFilter: 'Rings' })
  })

  it('does not resurrect a key another writer removed in the same flush', async () => {
    // The mirror image: clearing the search box on page 3 removes
    // `?searchKeyword` and resets the page. A stale base would have put the
    // search term the visitor just deleted straight back into the URL.
    const { router, replaced, settleAll } = makeRouter({ page: '3', searchKeyword: 'shoes' })
    const { write } = instantiate(router)

    write('searchKeyword', '')
    write('page', undefined)

    expect(replaced[1]).toEqual({})
    await settleAll()
    expect(router.query).toEqual({})
  })

  it('settles, and never oscillates when both sides are re-asserted', async () => {
    // Re-running every writer after the URL lands — which is what a re-render
    // does — must produce NO further navigation. An extra replace here is the
    // first step of the infinite loop.
    const { router, replaced, settleAll } = makeRouter({ page: '5' })
    const { write } = instantiate(router)

    write('categoryFilter', 'Rings')
    write('page', undefined)
    await settleAll()

    const settledCount = replaced.length
    write('categoryFilter', 'Rings')
    write('page', undefined)
    expect(replaced).toHaveLength(settledCount)
  })

  it('bails without a replace when the key already holds the value', () => {
    const { router, replaced } = makeRouter({ sortBy: 'price-asc' })
    const { write } = instantiate(router)

    write('sortBy', 'price-asc')
    expect(replaced).toHaveLength(0)

    // ...and removing an absent key is equally a no-op.
    write('missing', undefined)
    expect(replaced).toHaveLength(0)
  })

  it('coerces to a string, so a numeric page and a string filter round-trip alike', () => {
    const { router, replaced } = makeRouter({})
    const { write } = instantiate(router)

    write('page', 3)
    expect(replaced[0]).toEqual({ page: '3' })
  })

  it('reports settled only once every replace it issued has landed', async () => {
    const { router, settleAll } = makeRouter({ page: '5' })
    const { ref, write } = instantiate(router)

    expect(ref.current.inFlight).toBe(0)
    write('categoryFilter', 'Rings')
    write('page', undefined)
    // The page ⇄ URL effect reads this to know that `router.query` is a value
    // the page is on its way OUT of, and must not be adopted.
    expect(ref.current.inFlight).toBe(2)

    await settleAll()
    expect(ref.current.inFlight).toBe(0)
    expect(ref.current.pending).toBeNull()
  })

  it('releases the pending query even when a navigation is rejected', async () => {
    // A cancelled route must not freeze every later write against a stale base.
    const router = {
      pathname: '/products',
      query: { page: '5' } as Record<string, string>,
      replace: () => Promise.reject(new Error('route cancelled')),
    }
    const { ref, write } = instantiate(router)

    write('categoryFilter', 'Rings')
    await Promise.resolve()
    await Promise.resolve()

    expect(ref.current.inFlight).toBe(0)
    expect(ref.current.pending).toBeNull()
  })

  it('picks up an external navigation once nothing is in flight', async () => {
    // Browser back/forward moves the URL without asking us. The next write must
    // build on where the browser actually is, not on our last request.
    const { router, replaced, settleAll } = makeRouter({ page: '5' })
    const { write } = instantiate(router)

    write('categoryFilter', 'Rings')
    await settleAll()

    router.query = { locale: 'fr' } // an external navigation
    write('page', 2)

    expect(replaced[replaced.length - 1]).toEqual({ locale: 'fr', page: '2' })
  })
})
