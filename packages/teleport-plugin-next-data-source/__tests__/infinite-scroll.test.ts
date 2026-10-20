/* tslint:disable:function-constructor */
import * as types from '@babel/types'
import generator from '@babel/generator'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createNextArrayMapperPaginationPlugin } from '../src/pagination-plugin'
import {
  buildAccumulatingRequestMark,
  buildAccumulatingResponseHandler,
  getInfiniteScrollVars,
} from '../src/infinite-scroll'
import {
  makeMultiMapperUidl,
  makeUidlNode,
  makeWidgetComponentChunk,
  type RepeaterOptions,
} from './_helpers/pagination-widget-fixture'

const runPlugin = async (
  repeater: RepeaterOptions,
  controls: string[] = ['previous', 'next'],
  rootTag?: string
): Promise<string> => {
  const chunk = makeWidgetComponentChunk({ controls, rootTag })
  const structure: ComponentStructure = {
    uidl: { name: 'TestComponent', node: makeUidlNode(repeater) },
    chunks: [chunk],
    dependencies: {},
    options: { dataSources: {}, extractedResources: {} },
  } as never
  await createNextArrayMapperPaginationPlugin()(structure)
  return generator(chunk.content as types.Node).code
}

const collapse = (code: string): string => code.replace(/\s+/g, ' ')

describe('pagination plugin — infinite scroll', () => {
  it('accumulates pages inside fetchData and reports the end of the data', async () => {
    const code = await runPlugin({ infiniteScroll: true })
    const flat = collapse(code)

    expect(flat).toContain('const ds_0_accumRef = useRef({ sig: "", pages: {}, latest: null })')
    expect(flat).toContain('const [ds_0_hasMoreFlag, setDs_0_hasMoreFlag] = useState(true)')
    // Two independent end-of-data signals: a short page, and the counted total.
    expect(flat).toContain(
      'const ds_0_hasMore = ds_0_hasMoreFlag && (ds_0_maxPages === 0 || ds_0_page < ds_0_maxPages)'
    )

    // Everything but the page identifies the QUERY: a filter, sort or search
    // change must start a fresh list rather than interleave two result sets.
    expect(flat).toContain('const sig = JSON.stringify({ ...params, page: 0 })')
    expect(flat).toContain('if (ds_0_accumRef.current.sig !== sig)')
    expect(flat).toContain('ds_0_accumRef.current.pages = {}')
    expect(flat).toContain('ds_0_accumRef.current.pages[page] = rows')
    // fetchData records the request the list stands on before making it.
    expect(flat).toContain(
      'ds_0_accumRef.current.latest = { sig: JSON.stringify({ ...params, page: 0 }), page: Number(params.page) || 1 }'
    )
    // A short page is the only end signal a source that cannot count gives.
    expect(flat).toContain('setDs_0_hasMoreFlag(rows.length >= 20)')
    // Numeric sort, so page 10 does not land between 1 and 2.
    expect(flat).toMatch(
      /\.map\(Number\)\.filter\(\(?p\)? => p <= last\)\.sort\(\(a, b\) => a - b\)\.reduce\(/
    )
  })

  it('keeps the page out of the provider key and suppresses initialData', async () => {
    const code = await runPlugin({ infiniteScroll: true })

    // Remounting per appended page would throw away the accumulated rows...
    expect(code).not.toContain('ds_0_page}`')
    // ...and initialData would make DataProvider skip the fetch that fills the
    // accumulator with page 1.
    expect(code).not.toContain('initialData')
  })

  it('observes a sentinel after the list when there is no Load More button', async () => {
    const code = await runPlugin({ infiniteScroll: true })
    const flat = collapse(code)

    expect(flat).toContain('const ds_0_sentinelRef = useRef(null)')
    expect(flat).toContain(
      '<div ref={ds_0_sentinelRef} aria-hidden="true" style={{ height: "1px" }} />'
    )
    expect(flat).toContain('new IntersectionObserver(')
    expect(flat).toContain('typeof IntersectionObserver === "undefined"')
    expect(flat).toContain('rootMargin: "200px"')
    expect(flat).toContain('return () => observer.disconnect()')
    expect(flat).toContain('}, [ds_0_hasMore, ds_0_maxPages])')
    // ⛔ The next page comes from the updater's OWN argument. The effect is
    // re-armed on hasMore/maxPages, neither of which changes on an append while
    // the total is unknown — a captured page would still read 1 on the second
    // intersection and the list would stop growing after one page.
    expect(flat).toContain(
      'setDs_0_page(page => ds_0_maxPages > 0 && page >= ds_0_maxPages ? page : page + 1)'
    )
  })

  it('builds the sentinel as an element its parent may hold', async () => {
    // A <div> among a table's rows is moved out of the table by the parser:
    // the server's markup and the client's tree then differ and hydration fails.
    const inBody = collapse(
      await runPlugin({ infiniteScroll: true }, ['previous', 'next'], 'tbody')
    )
    expect(inBody).toContain(
      '<tr ref={ds_0_sentinelRef} aria-hidden="true" style={{ height: "1px" }}><td style={{ padding: 0, border: 0 }} /></tr>'
    )
    expect(inBody).not.toContain('<div ref={ds_0_sentinelRef}')

    const inList = collapse(await runPlugin({ infiniteScroll: true }, ['previous', 'next'], 'ul'))
    expect(inList).toContain(
      '<li ref={ds_0_sentinelRef} aria-hidden="true" style={{ height: "1px", listStyle: "none" }} />'
    )

    const inParagraph = collapse(
      await runPlugin({ infiniteScroll: true }, ['previous', 'next'], 'p')
    )
    expect(inParagraph).toContain(
      '<span ref={ds_0_sentinelRef} aria-hidden="true" style={{ display: "block", height: "1px" }} />'
    )
  })

  it('wires the authored Load More button instead, with no observer', async () => {
    const code = await runPlugin({ infiniteScroll: true, infiniteScrollLoadMore: true }, [
      'load-more',
    ])
    const flat = collapse(code)

    expect(flat).toContain('className="thq-load-more-elm"')
    expect(flat).toContain('type="button"')
    expect(flat).toContain('disabled={!ds_0_hasMore}')
    expect(flat).not.toContain('IntersectionObserver')
    expect(flat).not.toContain('sentinelRef')
  })

  it('drops page controls left in the widget when the list appends', async () => {
    const code = await runPlugin({ infiniteScroll: true, infiniteScrollLoadMore: true }, [
      'previous',
      'load-more',
      'next',
    ])

    // A visitor of an appending list never leaves page 1, so Previous/Next
    // would be dead controls.
    expect(code).not.toContain('thq-previous-elm')
    expect(code).not.toContain('thq-next-elm')
    expect(code).toContain('thq-load-more-elm')
  })

  it('strips a widget left behind on an auto-loading list', async () => {
    // An older project (or an externally placed widget) can still carry
    // Previous/Next after the author switches to infinite scroll. They would be
    // dead controls, so the mode's own pruning removes them even though this
    // mapper renders no widget of its own.
    const code = await runPlugin({ infiniteScroll: true }, ['previous', 'next'])

    expect(code).not.toContain('thq-previous-elm')
    expect(code).not.toContain('thq-next-elm')
  })

  it('does not desynchronise the widget zip when mappers use different modes', async () => {
    // ⛔ The infinite mapper draws no container. Counting one for it would wire
    // THIS mapper's buttons to the other mapper's state.
    const chunk = makeWidgetComponentChunk({ controls: ['previous', 'next'], mappers: 1 })
    const structure: ComponentStructure = {
      uidl: {
        name: 'TestComponent',
        node: makeMultiMapperUidl([{ infiniteScroll: true }, {}]),
      },
      chunks: [chunk],
      dependencies: {},
      options: { dataSources: {}, extractedResources: {} },
    } as never
    await createNextArrayMapperPaginationPlugin()(structure)
    const code = generator(chunk.content as types.Node).code

    // The single authored widget belongs to the SECOND (paginated) mapper.
    expect(code).toContain('setDs_1_page')
    expect(code).not.toContain('setDs_0_page(page => Math.max(1, page - 1))')
  })
})

/**
 * The accumulator, executed: `fetchData` as the page emits it, answered in
 * the orders a browser can produce. A sort (filter, search) change made on
 * page 2 fires page 2 under the new query first, then page 1 once the page is
 * reset — and `DataProvider` renders whichever answer lands last.
 */
describe('the appending list, run', () => {
  const PER_PAGE = 2

  interface Deferred {
    params: { page: number; sorts: string }
    resolve: (rows: string[]) => void
    result: Promise<string[]>
  }

  function bootList() {
    const vars = getInfiniteScrollVars(0)
    const mark = generator(types.program([buildAccumulatingRequestMark(vars)])).code
    const handler = generator(buildAccumulatingResponseHandler(vars, PER_PAGE)).code
    const accumRef = { current: { sig: '', pages: {}, latest: null } }
    const hasMore: boolean[] = []
    const fetchData = new Function(
      'ds_0_accumRef',
      'setDs_0_hasMoreFlag',
      'answer',
      `return function fetchData(params) { ${mark}; return answer(params).then(${handler}) }`
    )(
      accumRef,
      (value: boolean) => hasMore.push(value),
      (params: Deferred['params']) => {
        let resolve: (rows: string[]) => void = () => undefined
        const answered = new Promise<{ data: string[] }>((done) => {
          resolve = (rows) => done({ data: rows })
        })
        requests.push({ params, resolve, result: undefined as never })
        return answered
      }
    ) as (params: Deferred['params']) => Promise<string[]>
    const requests: Deferred[] = []
    const request = (page: number, sorts: string): Deferred => {
      const result = fetchData({ page, sorts })
      const made = requests[requests.length - 1]
      made.result = result
      return made
    }
    return { request, hasMore }
  }

  const rowsOf = (sorts: string, page: number) => [`${sorts}${page}a`, `${sorts}${page}b`]

  it('restarts at page 1 after a sort change on page 2, and loads page 2 on the next click', async () => {
    const list = bootList()
    const first = list.request(1, 'A')
    first.resolve(rowsOf('A', 1))
    const second = list.request(2, 'A')
    second.resolve(rowsOf('A', 2))
    expect(await second.result).toEqual([...rowsOf('A', 1), ...rowsOf('A', 2)])

    const stray = list.request(2, 'B')
    const restart = list.request(1, 'B')
    stray.resolve(rowsOf('B', 2))
    // The stray page changes nothing: the list on show stays until page 1 answers.
    expect(await stray.result).toEqual([...rowsOf('A', 1), ...rowsOf('A', 2)])
    restart.resolve(rowsOf('B', 1))
    expect(await restart.result).toEqual(rowsOf('B', 1))

    const next = list.request(2, 'B')
    next.resolve(rowsOf('B', 2))
    expect(await next.result).toEqual([...rowsOf('B', 1), ...rowsOf('B', 2)])
  })

  it('keeps the restarted list when the stray page answers last', async () => {
    const list = bootList()
    list.request(1, 'A').resolve(rowsOf('A', 1))
    const second = list.request(2, 'A')
    second.resolve(rowsOf('A', 2))
    await second.result

    const stray = list.request(2, 'B')
    const restart = list.request(1, 'B')
    restart.resolve(rowsOf('B', 1))
    expect(await restart.result).toEqual(rowsOf('B', 1))
    stray.resolve(rowsOf('B', 2))
    expect(await stray.result).toEqual(rowsOf('B', 1))
  })

  it('never lets a late answer to an earlier query replace the list', async () => {
    const list = bootList()
    const before = list.request(1, 'A')
    const after = list.request(1, 'B')
    after.resolve(rowsOf('B', 1))
    expect(await after.result).toEqual(rowsOf('B', 1))
    before.resolve(rowsOf('A', 1))
    expect(await before.result).toEqual(rowsOf('B', 1))
  })

  it('ends the list on a short page of the request it stands on only', async () => {
    const list = bootList()
    const stray = list.request(2, 'A')
    const page1 = list.request(1, 'A')
    stray.resolve(['A2a'])
    await stray.result
    expect(list.hasMore).toEqual([])
    page1.resolve(rowsOf('A', 1))
    await page1.result
    const page2 = list.request(2, 'A')
    page2.resolve(['A2a'])
    expect(await page2.result).toEqual([...rowsOf('A', 1), 'A2a'])
    expect(list.hasMore).toEqual([true, false])
  })
})
